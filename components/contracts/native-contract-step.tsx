"use client";

import { FileLinks } from "@/components/documents/file-link";
import { FILE_BEARING } from "@/features/documents/file-ref";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import { ArrowRight, Download, LoaderCircle, PenLine, RotateCw, Send } from "lucide-react";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  contractDocumentSchema,
  recordOnlyFields,
  type ResolvedField,
} from "@/features/contracts/document";
import { STUDIO_SIGNING_STATEMENT } from "@/features/contracts/esign-consent";
import { formatSignedAt } from "@/features/contracts/format";
import { normaliseTypedName } from "@/features/contracts/signing-policy";
import { agreementChangedSincePrepared } from "@/features/contracts/agreement-version";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  prepareContract,
  resendContract,
  retrySignedCopy,
  sendContract,
  signedCopyUrl,
  voidContract,
} from "@/lib/contracts/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

type RecordValue = Record<string, unknown> & { id: string };

type Draft = {
  status: string;
  proposalId: string;
  documentHash: string;
  document: unknown;
  fields: ResolvedField[];
  unresolvedFields: string[];
  /** Schedule A parts nobody has given yet (functions/src/contracts/event-details.ts). */
  detailsMissing?: string[];
  mergeOverrides: Record<string, string>;
  clientName: string;
  clientEmail: string;
  templateVersion: number;
  /** The agreement version this draft was prepared from, and sends against. */
  templateVersionId?: string;
  source: string;
};

/**
 * The contract step for a studio that writes its agreement in StudioCue.
 *
 * Prepare → read it → fill anything the records can't answer → sign for the
 * studio and send. The studio signs first, so the couple's signature completes
 * the agreement in one step and the booking chain runs from there. A sent
 * contract can be withdrawn until it is signed; a signed one never can.
 *
 * Nothing here decides anything: every step is a command, and the server
 * re-resolves the contract from records before it lets one go out.
 */
export function NativeContractStep({
  projectId,
  proposal,
  contract,
  onChanged,
  jobKind = null,
}: {
  /** The job's kind (job-kinds.ts), to catch a wedding agreement on other work. */
  jobKind?: string | null;
  projectId: string;
  proposal: RecordValue;
  contract: RecordValue | null;
  onChanged: (message: string | null) => void;
}) {
  const workspace = useWorkspace();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(dataIsLive);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [signerName, setSignerName] = useState("");
  const [consented, setConsented] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [showText, setShowText] = useState(false);
  const [reload, setReload] = useState(0);
  /** The studio's agreement as it stands, to notice a draft written from an older one. */
  const [currentVersionId, setCurrentVersionId] = useState<string | null>(null);

  const live = contract && ["sent", "viewed", "completed"].includes(String(contract.status))
    ? contract
    : null;
  const status = String(live?.status ?? "");
  // Signing for the studio, withdrawing, sending again and remaking the
  // signed copy are owner/admin commands (functions/src/contracts). A
  // coordinator was offered all of them and refused by the server.
  const ownerOrAdmin = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  /**
   * The signed copy's job (pdfJobs/contract_seal_{id}), read when the copy
   * hasn't appeared. When it gave up, this page said "it usually takes a
   * minute" for good. null: not read (or not readable — coordinators can't).
   */
  const [sealStatus, setSealStatus] = useState<string | null>(null);
  const awaitingCopy =
    Boolean(live) && status === "completed" && !FILE_BEARING.contracts(live!).length && !live!.amendmentId;

  const loadDraft = useCallback(async () => {
    if (!dataIsLive) return;
    try {
      const { firestore } = getFirebaseClient();
      const snapshot = await getDoc(doc(firestore, "contractDrafts", projectId));
      const data = snapshot.exists() ? (snapshot.data() as Draft & { tenantId?: string }) : null;
      const usable =
        data &&
        data.tenantId === workspace.tenantId &&
        data.status === "draft" &&
        data.proposalId === proposal.id
          ? data
          : null;
      setDraft(usable);
      setOverrides(usable?.mergeOverrides ?? {});
      // The same lookup the server makes (loadAgreementTemplate): the tenant's
      // default agreement, unless archived, at its current version.
      let current: string | null = null;
      if (usable && workspace.tenantId) {
        try {
          const tenant = await getDoc(doc(firestore, "tenants", workspace.tenantId));
          const settings = tenant.get("defaultContractSettings") as { agreementTemplateId?: unknown } | undefined;
          const templateId = typeof settings?.agreementTemplateId === "string" ? settings.agreementTemplateId : "";
          if (templateId) {
            const head = await getDoc(doc(firestore, "agreementTemplates", templateId));
            if (head.exists() && head.get("status") !== "archived" && typeof head.get("currentVersionId") === "string") {
              current = head.get("currentVersionId") as string;
            }
          }
        } catch {
          // Unreadable is not "changed": the server still refuses a stale send.
          current = null;
        }
      }
      setCurrentVersionId(current);
    } catch {
      setDraft(null);
    } finally {
      setLoadingDraft(false);
    }
  }, [projectId, proposal.id, workspace.tenantId]);

  useEffect(() => {
    // The fetch lives in the effect; every setState lands after an await.
    void Promise.resolve().then(loadDraft);
  }, [loadDraft, reload]);

  const liveId = live?.id ?? null;
  const loadSeal = useCallback(async () => {
    if (!dataIsLive || !liveId || !awaitingCopy || !ownerOrAdmin) return;
    try {
      const { firestore } = getFirebaseClient();
      const job = await getDoc(doc(firestore, "pdfJobs", `contract_seal_${liveId}`));
      setSealStatus(job.exists() ? String(job.get("status") ?? "") : "missing");
    } catch {
      setSealStatus(null);
    }
  }, [awaitingCopy, liveId, ownerOrAdmin]);

  useEffect(() => {
    void Promise.resolve().then(loadSeal);
  }, [loadSeal, reload]);

  /**
   * Pre-filled only when the account's name reads as a person's. It is often
   * the studio's own name — set at signup — and on the production walk the
   * owner was one tick away from signing a contract as "FlawlessIQ".
   */
  useEffect(() => {
    const name = workspace.userName?.trim() ?? "";
    const looksLikeAPerson =
      name.split(/\s+/).length >= 2 &&
      !name.includes("@") &&
      name.toLowerCase() !== workspace.tenantName.trim().toLowerCase() &&
      !/^(signed-in user|loading)/i.test(name);
    if (!signerName && looksLikeAPerson) {
      queueMicrotask(() => setSignerName(name));
    }
  }, [signerName, workspace.userName, workspace.tenantName]);

  const parsed = useMemo(() => {
    const source = live ? live.document : draft?.document;
    const result = contractDocumentSchema.safeParse(source);
    return result.success ? result.data : null;
  }, [draft, live]);

  const fillable = (draft?.fields ?? []).filter(
    (field) => !recordOnlyFields.has(field.key) && field.source !== "record",
  );
  const missing = draft?.unresolvedFields ?? [];
  /**
   * A wedding agreement about to go out on other work. A studio with one
   * agreement sent "Wedding Photography & Videography Agreement" to a
   * corporate client and nothing said so (walk, 2026-10-03). Warned, not
   * blocked: the wording is the studio's to judge.
   */
  const agreementTitle = parsed?.title ?? "";
  const weddingAgreementOnOtherWork =
    Boolean(jobKind) && jobKind !== "wedding" && /wedding|bride|groom/i.test(agreementTitle);
  const detailsMissing = draft?.detailsMissing ?? [];
  /**
   * The studio edited its agreement after this draft was prepared. Sending
   * resolves against the draft's pinned version, so the old wording would go
   * out; the server refuses that now, and this says so before they sign.
   */
  const agreementStale = draft
    ? agreementChangedSincePrepared(draft.templateVersionId, currentVersionId)
    : false;

  async function run(label: string, action: () => Promise<unknown>, done: string | null) {
    setBusy(label);
    setError(null);
    try {
      const result = (await action()) as { mode?: string } | undefined;
      if (result && result.mode === "preview") {
        setError("Development preview: nothing was saved or sent.");
        return;
      }
      onChanged(done);
      setReload((current) => current + 1);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That didn't go through. Try again."));
      if (
        caught instanceof Error &&
        ["CONTRACT_CHANGED", "AGREEMENT_CHANGED_SINCE_PREPARED"].includes(caught.message)
      ) {
        setReload((current) => current + 1);
      }
    } finally {
      setBusy(null);
    }
  }

  const prepare = () =>
    run(
      "prepare",
      () => prepareContract({ projectId, proposalId: proposal.id, overrides }),
      null,
    );

  const send = () => {
    if (!draft) return;
    if (!normaliseTypedName(signerName)) {
      setError("Type your full name to sign for the studio.");
      return;
    }
    if (!consented) {
      setError("Tick the box to sign for the studio.");
      return;
    }
    const overridesChanged = JSON.stringify(overrides) !== JSON.stringify(draft.mergeOverrides ?? {});
    if (overridesChanged) {
      setError("Save the details you changed first, then read the contract once more.");
      return;
    }
    return run(
      "send",
      () => sendContract({ projectId, documentHash: draft.documentHash, studioSignerName: signerName }),
      `Signed and sent to ${draft.clientName || draft.clientEmail}. They'll sign in their portal.`,
    );
  };

  async function openSignedCopy() {
    if (!live) return;
    const path = `tenants/${workspace.tenantId}/projects/${projectId}/contracts/signed/${live.id}.pdf`;
    try {
      window.open(await signedCopyUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      setError(
        sealStatus && ["dead_letter", "failed", "missing"].includes(sealStatus)
          ? "The signed copy wasn't made. Use Make the signed copy again."
          : "The signed copy isn't ready yet. It usually takes a minute after signing.",
      );
    }
  }

  const signatures = Array.isArray(live?.signatures)
    ? (live!.signatures as Array<{ role: string; typedName: string; signedAt: string }>)
    : [];
  const clientSignature = signatures.find((signature) => signature.role === "client");
  const sealing = busy === "seal";
  const studioSignature = signatures.find((signature) => signature.role === "studio");

  if (loadingDraft) {
    return (
      <p className="native-contract-note">
        <LoaderCircle className="spin" aria-hidden size={15} /> Loading the contract…
      </p>
    );
  }

  // ---- Signed, or out for signature ------------------------------------
  if (live) {
    return (
      <div className="native-contract-step">
        <div className="native-contract-status">
          {status === "completed" ? (
            <p>
              <strong>{clientSignature?.typedName ?? "The client"} signed</strong>{" "}
              {clientSignature ? `on ${formatSignedAt(clientSignature.signedAt)}` : null}. The agreement is complete.
            </p>
          ) : (
            <p>
              <strong>Out for signature.</strong> Signed by {studioSignature?.typedName ?? "the studio"}
              {live.sentAt ? ` and sent ${formatSignedAt(live.sentAt)}` : ""}.{" "}
              {status === "viewed"
                ? `The client opened it${live.viewedAt ? ` ${formatSignedAt(live.viewedAt)}` : ""}.`
                : "The client hasn't opened it yet."}
            </p>
          )}
          {status !== "completed" ? (
            <p className="native-contract-note">
              {`They sign in their portal. A reminder goes out at 3 and 7 days if it’s still unsigned${
                live.lastResentAt ? `; you sent it again ${formatSignedAt(live.lastResentAt)}` : ""
              }.${ownerOrAdmin ? "" : " An owner or admin can send it again or withdraw it."}`}
            </p>
          ) : null}
          {awaitingCopy && sealStatus && ["dead_letter", "failed", "missing"].includes(sealStatus) ? (
            <p className="native-contract-note" role="status">
              <strong>The signed copy wasn&rsquo;t made.</strong>{" "}
              The agreement is signed and complete; only the PDF copy (and the email that carries it to them) is
              missing. Make it again.
            </p>
          ) : awaitingCopy && sealStatus && sealStatus !== "succeeded" ? (
            <p className="native-contract-note" role="status">
              The signed copy is being made. It&rsquo;s emailed to them when it&rsquo;s ready.
            </p>
          ) : null}
        </div>
        <div className="native-contract-actions">
          {/* The sealed copy's own record, opened in place. Until the seal
              lands there is no record yet, and the button says so. */}
          {status === "completed" && live && FILE_BEARING.contracts(live).length ? (
            <FileLinks files={FILE_BEARING.contracts(live)} />
          ) : status === "completed" ? (
            <button className="button button-dark" onClick={() => void openSignedCopy()} type="button">
              <Download aria-hidden size={15} /> Signed copy
            </button>
          ) : null}
          {awaitingCopy && ownerOrAdmin && sealStatus && ["dead_letter", "failed", "missing"].includes(sealStatus) ? (
            <button
              className="button button-light"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "seal",
                  () => retrySignedCopy({ contractId: live.id }),
                  "Making the signed copy again. It's emailed to them when it's ready.",
                )
              }
              type="button"
            >
              <RotateCw aria-hidden size={15} className={sealing ? "spin" : undefined} />
              {sealing ? "Starting…" : "Make the signed copy again"}
            </button>
          ) : null}
          <button className="button button-light" onClick={() => setShowText((value) => !value)} type="button">
            {showText ? "Hide the agreement" : "Read the agreement"}
          </button>
          {status !== "completed" && ownerOrAdmin ? (
            <button
              className="button button-light"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  "resend",
                  () => resendContract({ projectId, contractId: live.id }),
                  "Sent to them again.",
                )
              }
              type="button"
            >
              <Send aria-hidden size={15} />
              {busy === "resend" ? "Sending…" : "Send it again"}
            </button>
          ) : null}
          {status !== "completed" && ownerOrAdmin ? (
            <button className="button button-light" onClick={() => setVoiding((value) => !value)} type="button">
              Withdraw it
            </button>
          ) : null}
        </div>
        {voiding ? (
          <div className="native-contract-void">
            <label>
              Why are you withdrawing it? The client is told it was withdrawn; your reason stays in the job&rsquo;s history.
              <textarea
                maxLength={500}
                onChange={(event) => setVoidReason(event.target.value)}
                value={voidReason}
              />
            </label>
            <div className="native-contract-actions">
              <button
                className="button button-dark"
                disabled={busy !== null || voidReason.trim().length < 5}
                onClick={() =>
                  void run(
                    "void",
                    () => voidContract({ projectId, contractId: live.id, reason: voidReason.trim() }),
                    live.mode === "combined"
                      ? "Withdrawn. The client was told. Correct the proposal, or send a new booking agreement from it."
                      : "Withdrawn. The client was told. Prepare a new one when you're ready.",
                  ).then(() => setVoiding(false))
                }
                type="button"
              >
                {busy === "void" ? "Withdrawing…" : "Withdraw the agreement"}
              </button>
            </div>
          </div>
        ) : null}
        {showText && parsed ? (
          <div className="contract-sheet native-contract-preview">
            <ContractDocumentView document={parsed} />
          </div>
        ) : null}
        {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  // ---- Nothing prepared yet --------------------------------------------
  if (!draft) {
    return (
      <div className="native-contract-step">
        {contract?.status === "voided" ? (
          <p className="native-contract-note">
            The last agreement was withdrawn{contract.voidedAt ? ` ${formatSignedAt(contract.voidedAt)}` : ""}.
          </p>
        ) : null}
        <p>
          StudioCue writes the contract from your agreement and the proposal{" "}
          {String((proposal.clientSnapshot as { displayName?: string } | undefined)?.displayName ?? "the client")}{" "}
          accepted. You read it, sign for the studio, and send it.
        </p>
        <div className="native-contract-actions">
          <button className="button button-dark" disabled={busy !== null} onClick={() => void prepare()} type="button">
            {busy === "prepare" ? <LoaderCircle className="spin" aria-hidden size={15} /> : <PenLine aria-hidden size={15} />}
            {busy === "prepare" ? "Preparing…" : "Prepare the contract"}
          </button>
          <Link className="button button-light" href="/studio/contracts/agreement">
            Edit your agreement <ArrowRight aria-hidden size={15} />
          </Link>
        </div>
        {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  // ---- A draft to review and send --------------------------------------
  return (
    <div className="native-contract-step">
      <div className="native-contract-status">
        <p>
          <StatusBadge tone={missing.length ? "warning" : "info"}>
            {missing.length ? `${missing.length} to fill in` : "Ready to send"}
          </StatusBadge>{" "}
          {draft.source === "acceptance"
            ? "Prepared when the proposal was accepted, from agreement version "
            : "Prepared from agreement version "}
          {draft.templateVersion}. Highlighted text came from the job&rsquo;s records.
        </p>
        {agreementStale ? (
          <p className="native-contract-note" role="status">
            <strong>Your agreement changed since this was prepared — update it.</strong>{" "}
            Updating writes it again from your current agreement, keeping the details you filled in.
          </p>
        ) : null}
      </div>
      {fillable.length ? (
        <div className="native-contract-fields">
          {fillable.map((field) => (
            <label key={field.key}>
              {field.label}
              <input
                maxLength={500}
                onChange={(event) =>
                  setOverrides((current) => ({ ...current, [field.key]: event.target.value }))
                }
                placeholder={missing.includes(field.key) ? "Needed before sending" : undefined}
                type="text"
                value={overrides[field.key] ?? ""}
              />
            </label>
          ))}
        </div>
      ) : null}
      <div className="native-contract-actions">
        {fillable.length || agreementStale ? (
          <button
            className={agreementStale ? "button button-dark" : "button button-light"}
            disabled={busy !== null}
            onClick={() => void prepare()}
            type="button"
          >
            <RotateCw aria-hidden size={15} className={busy === "prepare" ? "spin" : undefined} />
            {busy === "prepare" ? "Updating…" : "Update the contract"}
          </button>
        ) : null}
        <Link className="button button-light" href="/studio/contracts/agreement">
          Edit your agreement
        </Link>
      </div>
      {weddingAgreementOnOtherWork ? (
        <p className="booking-delivery-warning" role="status">
          {`This agreement is titled “${agreementTitle}”, and this is ${jobKind === "portraits" ? "a family or portrait session" : jobKind === "corporate" ? "corporate work" : jobKind === "sports" ? "a sports job" : "another kind of work"}. Read it through before you send it, or edit your agreement so it fits.`}
        </p>
      ) : null}
      {detailsMissing.length ? (
        <p className="booking-delivery-warning" role="status">
          {`Wedding details not given yet: ${detailsMissing.join(", ").toLowerCase()}. They go in Schedule A as "To be confirmed" and are confirmed with the final details four weeks before. Ask the couple now if you'd rather they were in the signed agreement.`}
        </p>
      ) : null}
      {parsed ? (
        <div className="contract-sheet native-contract-preview">
          <ContractDocumentView document={parsed} missing={missing} showFields />
        </div>
      ) : null}
      {!ownerOrAdmin ? (
        <p className="native-contract-note">
          A studio owner or admin signs the contract for the studio and sends it to {draft.clientName || "the client"}.
        </p>
      ) : (
      <div className="native-contract-send">
        <label>
          Sign for the studio — type your full name
          <input
            autoComplete="name"
            maxLength={160}
            onChange={(event) => setSignerName(event.target.value)}
            placeholder="Your full name"
            type="text"
            value={signerName}
          />
        </label>
        <label className="native-contract-consent">
          <input checked={consented} onChange={(event) => setConsented(event.target.checked)} type="checkbox" />
          <span>{STUDIO_SIGNING_STATEMENT}</span>
        </label>
        <div className="native-contract-actions">
          <button
            className="button button-dark"
            disabled={busy !== null || missing.length > 0 || agreementStale}
            onClick={() => void send()}
            type="button"
          >
            {busy === "send" ? <LoaderCircle className="spin" aria-hidden size={15} /> : <Send aria-hidden size={15} />}
            {busy === "send" ? "Sending…" : `Sign & send to ${draft.clientName || "the client"}`}
          </button>
          {agreementStale ? (
            <span className="native-contract-note">Update it to your current agreement first.</span>
          ) : missing.length ? (
            <span className="native-contract-note">Fill in the highlighted details first.</span>
          ) : (
            <span className="native-contract-note">It goes to {draft.clientEmail}.</span>
          )}
        </div>
      </div>
      )}
      {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
    </div>
  );
}
