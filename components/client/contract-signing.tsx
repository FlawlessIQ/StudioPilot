"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, MessageCircle, PenLine } from "lucide-react";
import { Actions, Button, Card, KitRoot } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { contractDocumentSchema } from "@/features/contracts/document";
import { sectionDocument, type CombinedSection } from "@/features/contracts/combined";
import { currentEsignConsent } from "@/features/contracts/esign-consent";
import {
  normaliseTypedName,
  signingRefusalCopy,
  type SigningRefusal,
} from "@/features/contracts/signing-policy";
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import {
  signClientCombinedAgreement,
  signClientContract,
  viewClientContract,
} from "@/lib/client/portal-client";
import { signedCopyUrl } from "@/lib/contracts/command-client";
import { formatSignedAt as formatDateTime } from "@/features/contracts/format";
import { BillingAddressStep, useBillingAddressStep } from "@/components/client/billing-address-step";

type ContractRecord = Record<string, unknown> & { id: string };

/** Past this, a signed copy that hasn't appeared is stuck, not on its way. */
const SIGNED_COPY_OVERDUE_MS = 30 * 60 * 1000;

type SignatureSummary = {
  id: string;
  role: "studio" | "client";
  typedName: string;
  signedAt: string;
  /** Which part of a booking agreement it signs (H2). */
  section?: string;
};

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
  studioColor = null,
}: {
  contract: ContractRecord;
  onChanged: () => void;
  studioName: string | null;
  /** The studio's colour, for the signing sheet (it renders outside the page). */
  studioColor?: string | null;
}) {
  const workspace = useWorkspace();
  // A makeup client signs for what's included and is quoted; a couple's
  // photographer still covers the day and proposes.
  const photo = tradeProfile(workspace.tenantTrade).family === "photo";
  const partTwo = photo ? "your coverage and price" : "what’s included and the price";
  const offer = tradeVocab(workspace.tenantTrade).proposal.toLowerCase();
  const parsed = contractDocumentSchema.safeParse(contract.document);
  const status = String(contract.status ?? "");
  const signatures = signaturesOf(contract);
  const studioSignature = signatures.find((signature) => signature.role === "studio") ?? null;
  const clientSignature = signatures.find((signature) => signature.role === "client") ?? null;
  const awaiting = status === "sent" || status === "viewed";
  const [consented, setConsented] = useState(false);
  const [typedName, setTypedName] = useState("");
  // A booking agreement is signed twice: the terms, then the coverage (H2).
  const [typedNameCoverage, setTypedNameCoverage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  // The billing address, asked just before the signature when the studio's
  // sales tax needs it (components/client/billing-address-step.tsx).
  const billing = useBillingAddressStep({
    tenantId: workspace.tenantId,
    projectId: workspace.projectId,
    kind: "contract",
    active: signOpen,
  });
  const idempotencyKey = useRef<string | null>(null);
  const viewedFor = useRef<string | null>(null);
  // As of opening the page, not re-read on every render.
  const [openedAt] = useState(() => Date.now());
  const completedAt = Date.parse(String(contract.completedAt ?? ""));
  const copyOverdue = Number.isFinite(completedAt) && openedAt - completedAt > SIGNED_COPY_OVERDUE_MS;

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
      <Card>
        <p className="kit-body" role="alert">
          This agreement couldn&rsquo;t be displayed. Message your studio and they&rsquo;ll send it again.
        </p>
      </Card>
    );
  }

  const sections =
    contract.mode === "combined" && Array.isArray(contract.sections)
      ? (contract.sections as CombinedSection[])
      : null;
  const nameValid =
    normaliseTypedName(typedName) !== null &&
    (!sections || normaliseTypedName(typedNameCoverage) !== null);

  async function sign() {
    if (!workspace.tenantId || !workspace.projectId) return;
    // In the order the sheet shows them: address, consent, name.
    const address = billing.answer();
    if (!address.ok) {
      setError(address.message);
      return;
    }
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
      if (sections) {
        await signClientCombinedAgreement({
          tenantId: workspace.tenantId,
          projectId: workspace.projectId,
          contractId: contract.id,
          documentHash: String(contract.documentHash ?? ""),
          typedNameTerms: typedName,
          typedNameCoverage,
          consentVersion: currentEsignConsent.id,
          idempotencyKey: idempotencyKey.current,
          billingAddress: address.address,
        });
      } else {
        await signClientContract({
          tenantId: workspace.tenantId,
          projectId: workspace.projectId,
          contractId: contract.id,
          documentHash: String(contract.documentHash ?? ""),
          typedName,
          consentVersion: currentEsignConsent.id,
          idempotencyKey: idempotencyKey.current,
          billingAddress: address.address,
        });
      }
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

  // Kit markup (M3 of docs/mobile-first-client-crew-plan-2026-09-28.md). The
  // document keeps its own sheet styles (a design-system scope); signing moves
  // into a sheet opened from the sticky "Review & sign", where it used to sit
  // below the whole agreement. Every word of consent is unchanged: it is what
  // the signature covers.
  return (
    <>
      {status === "completed" ? (
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            <CheckCircle2 aria-hidden size={14} /> Signed
          </p>
          <h2 className="kit-section">Your agreement is signed</h2>
          <p className="kit-body" aria-live="polite">
            {clientSignature
              ? `You signed on ${formatDateTime(clientSignature.signedAt)}.`
              : "Every signature is in."}{" "}
            {/* The copy is emailed when it is made, not when they sign — and
                when making it failed this said "shortly" for good. */}
            {typeof contract.signedCopyPath === "string"
              ? "A copy has been emailed to you and is ready to download."
              : copyOverdue
                ? "Your signed copy is taking longer than usual. Your studio can make it again — message them if you need it."
                : "Your signed copy is being made. It'll be emailed to you and appear here in a minute or two."}
          </p>
          {typeof contract.signedCopyPath === "string" ? (
            <Button disabled={downloading} icon={downloading ? undefined : Download} onClick={() => void download()}>
              {downloading ? "Opening…" : "Download signed copy"}
            </Button>
          ) : null}
          <Button href="/client/payments" variant="secondary">
            Next: your retainer
          </Button>
        </Card>
      ) : null}
      {status === "voided" ? (
        <Card>
          <p className="kit-eyebrow">Withdrawn</p>
          <h2 className="kit-section">This agreement was withdrawn</h2>
          <p className="kit-body">
            {`${studioName ?? "Your studio"} withdrew it, so it can’t be signed. They’ll send an updated agreement.`}
          </p>
        </Card>
      ) : null}
      {/* Retired because the studio recorded the signature they took another
          way. It had no card, so the page showed an unsigned agreement with no
          word about why it couldn't be signed. */}
      {status === "superseded" ? (
        <Card tone="accent">
          <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
            <CheckCircle2 aria-hidden size={14} /> Nothing to sign
          </p>
          <h2 className="kit-section">Your studio has your signed agreement</h2>
          <p className="kit-body">
            {`${studioName ?? "Your studio"} recorded your signature on the agreement you signed with them another way, so this copy doesn’t need signing. There’s nothing more for you to do here.`}
          </p>
        </Card>
      ) : null}

      <section aria-label="The agreement" className="ds-root kit-doc" data-ds-theme="emerald">
        {sections ? (
          <div className="contract-sheet">
            {/* Each part, then its own signatures: the terms are signed before
                the coverage, and each signature is over its own part. */}
            {sections.map((section, index) => {
              const studioSig = signatures.find(
                (signature) => signature.role === "studio" && signature.section === section.key,
              );
              const clientSig = signatures.find(
                (signature) => signature.role === "client" && signature.section === section.key,
              );
              return (
                <div key={section.key}>
                  <ContractDocumentView
                    document={index === 0 ? { ...sectionDocument(parsed.data, section), title: parsed.data.title } : sectionDocument(parsed.data, section)}
                    showTitle={index === 0}
                  />
                  <div className="contract-signature-line">
                    <div className={`contract-signature-slot ${studioSig ? "" : "is-pending"}`}>
                      <small>{`${studioName ?? "Studio"} · ${section.key === "terms" ? "Part 1" : "Part 2"}`}</small>
                      <div className="contract-signature-name">{studioSig?.typedName ?? "Not yet signed"}</div>
                      {studioSig ? (
                        <div className="contract-signature-meta">Signed {formatDateTime(studioSig.signedAt)}</div>
                      ) : null}
                    </div>
                    <div className={`contract-signature-slot ${clientSig ? "" : "is-pending"}`}>
                      <small>{`Client · ${section.key === "terms" ? "Part 1" : "Part 2"}`}</small>
                      <div className="contract-signature-name">
                        {clientSig?.typedName ?? (awaiting ? "Your signature goes here" : "Not signed")}
                      </div>
                      {clientSig ? (
                        <div className="contract-signature-meta">Signed {formatDateTime(clientSig.signedAt)}</div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
        <div className="contract-sheet">
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
        </div>
        )}
      </section>

      {awaiting ? (
        <>
          <Link className="kit-caption" href="/client/messages?context=Agreement" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <MessageCircle aria-hidden size={15} /> Something to change? Ask before you sign
          </Link>
          <Actions>
            <Button icon={PenLine} onClick={() => setSignOpen(true)}>
              Review &amp; sign
            </Button>
          </Actions>
          <SheetDialog label="Sign this agreement" onClose={() => setSignOpen(false)} open={signOpen}>
            <KitRoot className="kit-embed kit-sheet" studio={{ color: studioColor }}>
              <div className="kit-stack" aria-label="Sign this agreement">
                <p className="kit-body">
                  {sections
                    ? `You’re signing both parts of the booking agreement with ${studioName ?? "your studio"} exactly as shown — the terms, then ${partTwo}. This also accepts the ${offer}.`
                    : `You’re signing the agreement with ${studioName ?? "your studio"} exactly as shown.`}
                </p>
                <BillingAddressStep billing={billing} />
                <label className="kit-check">
                  <input
                    checked={consented}
                    onChange={(event) => setConsented(event.target.checked)}
                    type="checkbox"
                  />
                  <span>{currentEsignConsent.label}</span>
                </label>
                <details className="kit-disclosure">
                  <summary>Read the full terms of signing electronically</summary>
                  {currentEsignConsent.disclosure.map((paragraph) => {
                    // Each paragraph opens with a short lead ("Paper instead.");
                    // bold it so the terms can be scanned on a phone. The words
                    // themselves are unchanged — they are what the signature hashes.
                    const lead = paragraph.match(/^([^.]{3,40}\.)\s/);
                    return lead ? (
                      <p className="kit-caption" key={paragraph}>
                        <strong>{lead[1]}</strong> {paragraph.slice(lead[0].length)}
                      </p>
                    ) : (
                      <p className="kit-caption" key={paragraph}>
                        {paragraph}
                      </p>
                    );
                  })}
                </details>
                <label className="kit-field">
                  <span className="kit-field-label">
                    {sections ? "Part 1 — the terms. Type your full name to sign" : "Type your full name to sign"}
                  </span>
                  <input
                    autoComplete="name"
                    className="kit-input"
                    maxLength={160}
                    onChange={(event) => setTypedName(event.target.value)}
                    placeholder="Your full name"
                    type="text"
                    value={typedName}
                  />
                </label>
                {sections ? (
                  <label className="kit-field">
                    <span className="kit-field-label">
                      Part 2 — {partTwo}. Type your full name to sign
                    </span>
                    <input
                      autoComplete="name"
                      className="kit-input"
                      maxLength={160}
                      onChange={(event) => setTypedNameCoverage(event.target.value)}
                      placeholder="Your full name"
                      type="text"
                      value={typedNameCoverage}
                    />
                  </label>
                ) : null}
                {typedName.trim() ? (
                  <p className="kit-signature-preview" aria-hidden>
                    {typedName.trim()}
                  </p>
                ) : null}
                {error ? (
                  <p className="kit-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button disabled={busy || !billing.ready} icon={busy ? undefined : PenLine} onClick={() => void sign()}>
                  {busy ? "Signing…" : sections ? "Sign both parts" : "Sign agreement"}
                </Button>
              </div>
            </KitRoot>
          </SheetDialog>
        </>
      ) : error ? (
        <p className="kit-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
