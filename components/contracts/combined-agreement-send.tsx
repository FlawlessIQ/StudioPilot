"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { FileSignature, LoaderCircle, Send } from "lucide-react";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { useNativeSigning } from "@/components/contracts/use-native-signing";
import { sectionDocument } from "@/features/contracts/combined";
import { STUDIO_SIGNING_STATEMENT } from "@/features/contracts/esign-consent";
import { normaliseTypedName } from "@/features/contracts/signing-policy";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  previewCombinedAgreement,
  sendCombinedAgreement,
  type CombinedAgreementPreview,
} from "@/lib/contracts/command-client";

/**
 * "Send as one booking agreement" (H2 Part B): the studio's terms and this
 * proposal's coverage and price, sent together for the couple to sign in one
 * sitting — signing accepts the proposal. For a photographer, shown only
 * where a platform admin has turned it on for the studio
 * (tenantFeatures.combinedAgreement), because counsel has still to see the
 * two-signature ceremony.
 *
 * A DJ, makeup artist or hair stylist books in one link (trades.ts
 * `journey.oneLinkBooking`), so it is on for them by default and is the way
 * they send a booking: "Send the booking link". Their client signs, then pays
 * the deposit on the same screen (components/client/kit/client-contract.tsx).
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
  // "quote" for a makeup artist or hair stylist (trades.ts).
  const offer = tradeVocab(workspace.tenantTrade).proposal.toLowerCase();
  const oneLink = tradeProfile(workspace.tenantTrade).journey.oneLinkBooking;
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
      setError("Check the box to sign for the studio.");
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
        <button
          className={oneLink ? "button button-dark" : "button button-light"}
          disabled={busy !== null}
          onClick={() => void open()}
          type="button"
        >
          {busy === "preview" ? <LoaderCircle className="spin" aria-hidden size={15} /> : <FileSignature aria-hidden size={15} />}
          {busy === "preview" ? "Preparing…" : oneLink ? "Send the booking link" : "Send as one booking agreement"}
        </button>
        <small className="native-contract-note">
          {oneLink
            ? `Your terms and this ${offer} in one link. The client signs, then pays the deposit on the next screen — booked in one visit.`
            : `Your terms and these prices together — the couple signs both at once, and that accepts the ${offer}.`}
        </small>
        {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
      </div>
    );
  }

  const missing = preview.unresolved;
  // The studio's own agreement may state the price too (the details section
  // an import adds does). Same figures, from the same proposal — but said
  // twice, so the studio is told how to say it once.
  const terms = preview.sections.find((section) => section.key === "terms");
  const termsStatePrice = terms
    ? preview.document.blocks.slice(terms.start, terms.end).some(
        (block) =>
          block.type === "payment_schedule" ||
          ("content" in block &&
            (block.content ?? []).some((piece) => piece.field?.startsWith("price.") || piece.field === "payment.schedule")) ||
          (block.type === "list" &&
            block.items.some((item) => item.content.some((piece) => piece.field?.startsWith("price.")))),
      )
    : false;
  // A whole agreement is read at reading width, not in the proposal's side
  // column (walked 2026-09-29: it rendered as a thin scrolling strip).
  // Portalled to the body: inside the proposal's side column it sat in that
  // column's stacking context, under the app's top bar.
  return createPortal(
    <div
      aria-label="Booking agreement"
      aria-modal="true"
      // Outside the app's .ds-root once portalled, so it carries its own.
      className="ds-root combined-agreement-overlay"
      data-ds-theme="emerald"
      onKeyDown={(event) => {
        if (event.key === "Escape" && busy === null) setPreview(null);
      }}
      role="dialog"
    >
    <div className="combined-agreement-send combined-agreement-sheet">
      <p className="eyebrow">{oneLink ? "Booking link" : "Booking agreement"}</p>
      {oneLink ? (
        <p className="native-contract-note">
          {`Part 1 is your agreement (version ${preview.templateVersion}); Part 2 is this ${offer}’s packages, extras, total and payment schedule. The client signs each part, then pays the deposit. Highlighted text came from the job’s records.`}
        </p>
      ) : (
      <p className="native-contract-note">
        Part 1 is your agreement (version {preview.templateVersion}); Part 2 is this {offer}&rsquo;s packages,
        extras, total and payment schedule. The couple signs each part. Highlighted text came from the job&rsquo;s
        records.
      </p>
      )}
      {termsStatePrice ? (
        <p className="native-contract-note">
          Your agreement (Part 1) also states the price and schedule. They&rsquo;re the same figures as Part 2, from
          this {offer}. To state them once, remove the price and schedule fields from{" "}
          <Link href="/studio/contracts/agreement">your agreement</Link>.
        </p>
      ) : null}
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
            {busy === "send"
              ? "Sending…"
              : oneLink
                ? `Sign & send the booking link to ${preview.clientName || "the client"}`
                : `Sign & send to ${preview.clientName || "the couple"}`}
          </button>
          <button className="button button-quiet" disabled={busy !== null} onClick={() => setPreview(null)} type="button">
            Cancel
          </button>
          {preview.clientEmail ? <span className="native-contract-note">It goes to {preview.clientEmail}.</span> : null}
        </div>
        {oneLink && preview.depositOnline === false ? (
          // Said before it goes, not found out after: with nothing to raise
          // the deposit invoice, the client can't pay on the next screen.
          <p className="native-contract-note" role="note">
            {`No QuickBooks or Stripe is connected, so ${preview.clientName || "the client"} can't pay on the next screen — they'll be asked to arrange the deposit with you, and you record it on the job's Booking tab. `}
            <Link href="/studio/integrations">Connect payments</Link>
            {" before they sign and they pay it on the spot."}
          </p>
        ) : null}
      </div>
      {error ? <p className="client-contract-error" role="alert">{error}</p> : null}
    </div>
    </div>,
    document.body,
  );
}
