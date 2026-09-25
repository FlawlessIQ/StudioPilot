"use client";

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
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  prepareContract,
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
  mergeOverrides: Record<string, string>;
  clientName: string;
  clientEmail: string;
  templateVersion: number;
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
}: {
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

  const live = contract && ["sent", "viewed", "completed"].includes(String(contract.status))
    ? contract
    : null;
  const status = String(live?.status ?? "");

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
      if (caught instanceof Error && caught.message === "CONTRACT_CHANGED") {
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
      setError("The signed copy isn't ready yet. It usually takes a minute after signing.");
    }
  }

  const signatures = Array.isArray(live?.signatures)
    ? (live!.signatures as Array<{ role: string; typedName: string; signedAt: string }>)
    : [];
  const clientSignature = signatures.find((signature) => signature.role === "client");
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
              They sign in their portal. A reminder goes out at 3 and 7 days if it&rsquo;s still unsigned.
            </p>
          ) : null}
        </div>
        <div className="native-contract-actions">
          {status === "completed" ? (
            <button className="button button-dark" onClick={() => void openSignedCopy()} type="button">
              <Download aria-hidden size={15} /> Signed copy
            </button>
          ) : null}
          <button className="button button-light" onClick={() => setShowText((value) => !value)} type="button">
            {showText ? "Hide the agreement" : "Read the agreement"}
          </button>
          {status !== "completed" ? (
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
                    "Withdrawn. The client was told. Prepare a new one when you're ready.",
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
        {fillable.length ? (
          <button className="button button-light" disabled={busy !== null} onClick={() => void prepare()} type="button">
            <RotateCw aria-hidden size={15} className={busy === "prepare" ? "spin" : undefined} />
            {busy === "prepare" ? "Updating…" : "Update the contract"}
          </button>
        ) : null}
        <Link className="button button-light" href="/studio/contracts/agreement">
          Edit your agreement
        </Link>
      </div>
      {parsed ? (
        <div className="contract-sheet native-contract-preview">
          <ContractDocumentView document={parsed} missing={missing} showFields />
        </div>
      ) : null}
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
            disabled={busy !== null || missing.length > 0}
            onClick={() => void send()}
            type="button"
          >
            {busy === "send" ? <LoaderCircle className="spin" aria-hidden size={15} /> : <Send aria-hidden size={15} />}
            {busy === "send" ? "Sending…" : `Sign & send to ${draft.clientName || "the client"}`}
          </button>
          {missing.length ? (
            <span className="native-contract-note">Fill in the highlighted details first.</span>
          ) : (
            <span className="native-contract-note">It goes to {draft.clientEmail}.</span>
          )}
        </div>
      </div>
      {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
    </div>
  );
}
