"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, LoaderCircle, MessageCircle, PenLine } from "lucide-react";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { contractDocumentSchema } from "@/features/contracts/document";
import { currentEsignConsent } from "@/features/contracts/esign-consent";
import {
  normaliseTypedName,
  signingRefusalCopy,
  type SigningRefusal,
} from "@/features/contracts/signing-policy";
import { useWorkspace } from "@/features/auth/workspace-context";
import { signClientContract, viewClientContract } from "@/lib/client/portal-client";
import { signedCopyUrl } from "@/lib/contracts/command-client";
import { formatSignedAt as formatDateTime } from "@/features/contracts/format";

type ContractRecord = Record<string, unknown> & { id: string };

type SignatureSummary = { id: string; role: "studio" | "client"; typedName: string; signedAt: string };

function signaturesOf(contract: ContractRecord): SignatureSummary[] {
  return Array.isArray(contract.signatures)
    ? (contract.signatures as SignatureSummary[]).filter(
        (signature) => signature && typeof signature.typedName === "string",
      )
    : [];
}

function refusalMessage(caught: unknown): { code: SigningRefusal | null; message: string } {
  const code = caught instanceof Error ? caught.message : "";
  if (code in signingRefusalCopy) {
    return { code: code as SigningRefusal, message: signingRefusalCopy[code as SigningRefusal] };
  }
  return {
    code: null,
    message: "Your signature didn't go through. Check your connection and try again — nothing was signed.",
  };
}

/**
 * The couple reads their agreement and signs it, here in the portal.
 *
 * The page sends back the hash of the exact text it showed, the consent
 * version it displayed, and the name they typed; the server checks all three
 * (server/contracts/client-signing.ts). If the studio changed the agreement
 * while it was open, the refusal says so and the page reloads the new text
 * rather than letting them sign something they did not read.
 */
export function ClientContractSigning({
  contract,
  onChanged,
  studioName,
}: {
  contract: ContractRecord;
  onChanged: () => void;
  studioName: string | null;
}) {
  const workspace = useWorkspace();
  const parsed = contractDocumentSchema.safeParse(contract.document);
  const status = String(contract.status ?? "");
  const signatures = signaturesOf(contract);
  const studioSignature = signatures.find((signature) => signature.role === "studio") ?? null;
  const clientSignature = signatures.find((signature) => signature.role === "client") ?? null;
  const awaiting = status === "sent" || status === "viewed";
  const [consented, setConsented] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const viewedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!awaiting || status !== "sent") return;
    if (!workspace.tenantId || !workspace.projectId) return;
    if (viewedFor.current === contract.id) return;
    viewedFor.current = contract.id;
    void viewClientContract(workspace.tenantId, workspace.projectId, contract.id).catch(() => {
      // Recording the first open is a courtesy to the studio; failing it must
      // never get in the way of reading or signing.
    });
  }, [awaiting, contract.id, status, workspace.projectId, workspace.tenantId]);

  if (!parsed.success) {
    return (
      <section className="panel">
        <p>This agreement couldn&rsquo;t be displayed. Message your studio and they&rsquo;ll send it again.</p>
      </section>
    );
  }

  const nameValid = normaliseTypedName(typedName) !== null;

  async function sign() {
    if (!workspace.tenantId || !workspace.projectId) return;
    if (!consented) {
      setError(signingRefusalCopy.CONSENT_REQUIRED);
      return;
    }
    if (!nameValid) {
      setError(signingRefusalCopy.NAME_REQUIRED);
      return;
    }
    setBusy(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      await signClientContract({
        tenantId: workspace.tenantId,
        projectId: workspace.projectId,
        contractId: contract.id,
        documentHash: String(contract.documentHash ?? ""),
        typedName,
        consentVersion: currentEsignConsent.id,
        idempotencyKey: idempotencyKey.current,
      });
      onChanged();
    } catch (caught: unknown) {
      const refusal = refusalMessage(caught);
      setError(refusal.message);
      // A new key for the next attempt only when this one was refused; a
      // network failure retries with the same key so it cannot sign twice.
      if (refusal.code) idempotencyKey.current = null;
      if (refusal.code === "DOCUMENT_CHANGED" || refusal.code === "CONTRACT_ALREADY_SIGNED" || refusal.code === "CONTRACT_VOIDED") {
        onChanged();
      }
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const path = typeof contract.signedCopyPath === "string" ? contract.signedCopyPath : null;
    if (!path) return;
    setDownloading(true);
    try {
      window.open(await signedCopyUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      setError("Your signed copy couldn't be opened just now. It's also in the email we sent you.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="client-contract-signing">
      {status === "completed" ? (
        <section className="panel client-contract-done" aria-live="polite">
          <p className="eyebrow">Signed</p>
          <h2>
            <CheckCircle2 aria-hidden /> Your agreement is signed
          </h2>
          <p>
            {clientSignature
              ? `You signed on ${formatDateTime(clientSignature.signedAt)}.`
              : "Every signature is in."}{" "}
            A copy has been emailed to you{typeof contract.signedCopyPath === "string" ? " and is ready to download" : " and will be ready to download here shortly"}.
          </p>
          <div className="client-contract-actions">
            {typeof contract.signedCopyPath === "string" ? (
              <button className="button button-dark" disabled={downloading} onClick={() => void download()} type="button">
                {downloading ? <LoaderCircle className="spin" aria-hidden /> : <Download aria-hidden />}
                Download signed copy
              </button>
            ) : null}
            <Link className="button button-light" href="/client/payments">
              Next: your retainer
            </Link>
          </div>
        </section>
      ) : null}
      {status === "voided" ? (
        <section className="panel">
          <p className="eyebrow">Withdrawn</p>
          <h2>This agreement was withdrawn</h2>
          <p>{studioName ?? "Your studio"} withdrew it, so it can&rsquo;t be signed. They&rsquo;ll send an updated agreement.</p>
        </section>
      ) : null}

      <section className="contract-sheet">
        <ContractDocumentView document={parsed.data} />
        <div className="contract-signature-line">
          <div className={`contract-signature-slot ${studioSignature ? "" : "is-pending"}`}>
            <small>{studioName ?? "Studio"}</small>
            <div className="contract-signature-name">{studioSignature?.typedName ?? "Not yet signed"}</div>
            {studioSignature ? (
              <div className="contract-signature-meta">Signed {formatDateTime(studioSignature.signedAt)}</div>
            ) : null}
          </div>
          <div className={`contract-signature-slot ${clientSignature ? "" : "is-pending"}`}>
            <small>Client</small>
            <div className="contract-signature-name">
              {clientSignature?.typedName ?? (awaiting ? "Your signature goes here" : "Not signed")}
            </div>
            {clientSignature ? (
              <div className="contract-signature-meta">Signed {formatDateTime(clientSignature.signedAt)}</div>
            ) : null}
          </div>
        </div>
      </section>

      {awaiting ? (
        <section className="client-contract-sign-panel" aria-label="Sign this agreement">
          <label className="client-contract-consent">
            <input
              checked={consented}
              onChange={(event) => setConsented(event.target.checked)}
              type="checkbox"
            />
            <span>{currentEsignConsent.label}</span>
          </label>
          <details className="client-contract-disclosure">
            <summary>Read the full terms of signing electronically</summary>
            {currentEsignConsent.disclosure.map((paragraph) => {
              // Each paragraph opens with a short lead ("Paper instead.");
              // bold it so the terms can be scanned on a phone. The words
              // themselves are unchanged — they are what the signature hashes.
              const lead = paragraph.match(/^([^.]{3,40}\.)\s/);
              return lead ? (
                <p key={paragraph}>
                  <strong>{lead[1]}</strong> {paragraph.slice(lead[0].length)}
                </p>
              ) : (
                <p key={paragraph}>{paragraph}</p>
              );
            })}
          </details>
          <label className="client-contract-name">
            Type your full name to sign
            <input
              autoComplete="name"
              maxLength={160}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder="Your full name"
              type="text"
              value={typedName}
            />
          </label>
          {typedName.trim() ? (
            <div className="client-contract-name-preview" aria-hidden>
              {typedName.trim()}
            </div>
          ) : null}
          {error ? (
            <p className="client-contract-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="button button-dark"
            disabled={busy}
            onClick={() => void sign()}
            type="button"
          >
            {busy ? <LoaderCircle className="spin" aria-hidden /> : <PenLine aria-hidden />}
            {busy ? "Signing…" : "Sign agreement"}
          </button>
          <Link className="client-context-message-link" href="/client/messages?context=Agreement">
            <MessageCircle aria-hidden /> Something to change? Ask before you sign
          </Link>
        </section>
      ) : error ? (
        <p className="client-contract-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
