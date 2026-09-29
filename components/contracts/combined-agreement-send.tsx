"use client";

import { useState } from "react";
import Link from "next/link";
import { FileSignature, LoaderCircle, Send } from "lucide-react";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { useNativeSigning } from "@/components/contracts/use-native-signing";
import { sectionDocument } from "@/features/contracts/combined";
import { STUDIO_SIGNING_STATEMENT } from "@/features/contracts/esign-consent";
import { normaliseTypedName } from "@/features/contracts/signing-policy";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  previewCombinedAgreement,
  sendCombinedAgreement,
  type CombinedAgreementPreview,
} from "@/lib/contracts/command-client";

/**
 * "Send as one booking agreement" (H2 Part B): the studio's terms and this
 * proposal's coverage and price, sent together for the couple to sign in one
 * sitting — signing accepts the proposal. Shown only where a platform admin
 * has turned it on for the studio (tenantFeatures.combinedAgreement), because
 * counsel has still to see the two-signature ceremony.
 *
 * The studio reads both parts exactly as they will go, then the owner signs
 * both for the studio as they send, as for any StudioCue contract.
 */
export function CombinedAgreementSend({
  projectId,
  proposalId,
  onSent,
}: {
  projectId: string;
  proposalId: string;
  onSent: () => void;
}) {
  const workspace = useWorkspace();
  const native = useNativeSigning(0);
  const canSign = ["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""));
  const [preview, setPreview] = useState<CombinedAgreementPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [signerName, setSignerName] = useState("");
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!native.combined || !canSign) return null;

  async function open() {
    setBusy("preview");
    setError(null);
    try {
      const next = await previewCombinedAgreement({ projectId, proposalId });
      if (!next) {
        setError("Development preview: the agreement isn't built here.");
        return;
      }
      setPreview(next);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The booking agreement couldn't be prepared."));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!preview) return;
    if (!normaliseTypedName(signerName)) {
      setError("Type your full name to sign for the studio.");
      return;
    }
    if (!consented) {
      setError("Tick the box to sign for the studio.");
      return;
    }
    setBusy("send");
    setError(null);
    try {
      await sendCombinedAgreement({
        projectId,
        proposalId,
        documentHash: preview.documentHash,
        studioSignerName: signerName,
      });
      setPreview(null);
      onSent();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The booking agreement wasn't sent. Nothing went to the couple."));
      // The text moved since it was read: show the new text, never send it unread.
      if (caught instanceof Error && caught.message === "CONTRACT_CHANGED") setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  if (!preview) {
    return (
      <div className="combined-agreement-send">
        <button className="button button-light" disabled={busy !== null} onClick={() => void open()} type="button">
          {busy === "preview" ? <LoaderCircle className="spin" aria-hidden size={15} /> : <FileSignature aria-hidden size={15} />}
          {busy === "preview" ? "Preparing…" : "Send as one booking agreement"}
        </button>
        <small className="native-contract-note">
          Your terms and these prices together — the couple signs both at once, and that accepts the proposal.
        </small>
        {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  const missing = preview.unresolved;
  return (
    <div className="combined-agreement-send">
      <p className="eyebrow">Booking agreement</p>
      <p className="native-contract-note">
        Part 1 is your agreement (version {preview.templateVersion}); Part 2 is this proposal&rsquo;s packages,
        extras, total and payment schedule. The couple signs each part. Highlighted text came from the job&rsquo;s
        records.
      </p>
      {missing.length ? (
        <p className="client-contract-error" role="alert">
          {missing.length} detail{missing.length === 1 ? "" : "s"} still to fill in:{" "}
          {missing.join(", ")}. Fill {missing.length === 1 ? "it" : "them"} in on the job, or{" "}
          <Link href="/studio/contracts/agreement">edit your agreement</Link>.
        </p>
      ) : null}
      <div className="contract-sheet native-contract-preview">
        {preview.sections.map((section, index) => (
          <ContractDocumentView
            document={
              index === 0
                ? { ...sectionDocument(preview.document, section), title: preview.document.title }
                : sectionDocument(preview.document, section)
            }
            key={section.key}
            missing={missing}
            showFields
            showTitle={index === 0}
          />
        ))}
      </div>
      <div className="native-contract-send">
        <label>
          Sign both parts for the studio — type your full name
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
            {busy === "send" ? "Sending…" : `Sign & send to ${preview.clientName || "the couple"}`}
          </button>
          <button className="button button-quiet" disabled={busy !== null} onClick={() => setPreview(null)} type="button">
            Cancel
          </button>
          {preview.clientEmail ? <span className="native-contract-note">It goes to {preview.clientEmail}.</span> : null}
        </div>
      </div>
      {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
    </div>
  );
}
