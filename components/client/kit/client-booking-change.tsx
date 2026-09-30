"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, PenLine } from "lucide-react";
import { Button, ButtonRow, Card, KitRoot } from "@/components/kit/kit";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { contractDocumentSchema } from "@/features/contracts/document";
import { currentEsignConsent } from "@/features/contracts/esign-consent";
import { normaliseTypedName, signingRefusalCopy, type SigningRefusal } from "@/features/contracts/signing-policy";
import { formatSignedAt } from "@/features/contracts/format";
import { useWorkspace } from "@/features/auth/workspace-context";
import { withdrawnChangeShown } from "@/features/contracts/couple-view";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  getClientBookingChange,
  signClientBookingChange,
  type ClientBookingChange as Change,
} from "@/lib/client/portal-client";
import { InfoHint } from "@/components/ui/info-hint";

/**
 * A change to a booking the couple already signed.
 *
 * The studio changed the date or the packages (functions/src/contracts/
 * amendments.ts). The couple reads what changes, the agreement as it stands
 * after the change, and signs once — the original agreement stands until they
 * do. Shown at the top of their agreement and on their home page.
 */
export function ClientBookingChange({ compact = false }: { compact?: boolean } = {}) {
  const workspace = useWorkspace();
  const [change, setChange] = useState<Change | null>(null);
  const [reload, setReload] = useState(0);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState(false);
  const [consented, setConsented] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.projectId) return;
    let active = true;
    void getClientBookingChange(workspace.tenantId, workspace.projectId)
      .then((result) => active && setChange(result.change))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace.tenantId, workspace.projectId, reload]);

  if (!change) return null;
  const studio = workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "Your studio";
  // Withdrawn after it was sent: it used to vanish from under a couple who had
  // been emailed to sign it, or refuse their signature with "they'll send a
  // new one". Say what happened and that nothing changed.
  if (change.status === "cancelled") {
    if (!withdrawnChangeShown(change, openedAt, compact)) return null;
    return (
      <Card>
        <p className="kit-eyebrow">Change withdrawn</p>
        <h2 className="kit-section">{`${studio} withdrew the change to your booking`}</h2>
        {change.changes.length ? (
          <ul className="kit-body">
            {change.changes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
        <p className="kit-body">Your booking stands exactly as it was, and there&rsquo;s nothing for you to sign.</p>
      </Card>
    );
  }
  const signed = ["signed", "applied"].includes(change.status);
  // A signed change is worth a line for a while, not forever.
  if (signed && compact) return null;
  const parsed = contractDocumentSchema.safeParse(change.document);

  async function sign() {
    if (!change || !workspace.tenantId || !workspace.projectId || !change.documentHash) return;
    if (!consented) return setError(signingRefusalCopy.CONSENT_REQUIRED);
    setBusy(true);
    setError(null);
    try {
      await signClientBookingChange({
        tenantId: workspace.tenantId,
        projectId: workspace.projectId,
        amendmentId: change.id,
        documentHash: change.documentHash,
        typedName,
        consentVersion: currentEsignConsent.id,
        idempotencyKey: `amend_${change.id}_${Date.now()}`,
      });
      setOpen(false);
      setReload((value) => value + 1);
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "";
      setError(
        code in signingRefusalCopy
          ? signingRefusalCopy[code as SigningRefusal]
          : "Your signature didn't go through. Check your connection and try again — nothing was signed.",
      );
      if (code === "DOCUMENT_CHANGED" || code === "CHANGE_WITHDRAWN") setReload((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  if (signed)
    return (
      <Card tone="accent">
        <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
          <CheckCircle2 aria-hidden size={14} /> Change signed
        </p>
        <p className="kit-body">
          {change.signedAt ? `You signed the change to your booking on ${formatSignedAt(change.signedAt)}.` : "The change to your booking is signed."}
        </p>
      </Card>
    );

  return (
    <Card tone="accent">
      <p className="kit-eyebrow" style={{ color: "var(--kit-accent)" }}>
        <PenLine aria-hidden size={14} /> A change to sign
      </p>
      <h2 className="kit-section">
        {`${studio} sent a change to your booking`} <InfoHint term="couple-booking-change" />
      </h2>
      <ul className="kit-body">
        {change.changes.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="kit-caption">Everything else stays as you agreed. Your current agreement stands until you sign this.</p>
      <ButtonRow>
        <Button icon={PenLine} onClick={() => setOpen(true)}>
          Review &amp; sign
        </Button>
      </ButtonRow>
      <SheetDialog label="Sign the change to your booking" onClose={() => (busy ? undefined : setOpen(false))} open={open}>
        <KitRoot className="kit-embed kit-sheet" studio={{ color: workspace.tenantBrand?.primaryColor ?? null }}>
          <div className="kit-stack" aria-label="Sign the change to your booking">
            <p className="kit-body">{`You’re signing this change to your agreement with ${studio}, exactly as written.`}</p>
            {parsed.success ? (
              <>
                <Button onClick={() => setReading((value) => !value)} variant="secondary">
                  {reading ? "Hide the amended agreement" : "Read the amended agreement"}
                </Button>
                {reading ? (
                  <section aria-label="The amended agreement" className="ds-root kit-doc" data-ds-theme="emerald">
                    <div className="contract-sheet">
                      <ContractDocumentView document={parsed.data} />
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}
            <label className="kit-check">
              <input checked={consented} onChange={(event) => setConsented(event.target.checked)} type="checkbox" />
              <span>{currentEsignConsent.label}</span>
            </label>
            <details className="kit-disclosure">
              <summary>Read the full terms of signing electronically</summary>
              {currentEsignConsent.disclosure.map((paragraph) => (
                <p className="kit-caption" key={paragraph}>
                  {paragraph}
                </p>
              ))}
            </details>
            <label className="kit-field">
              <span className="kit-field-label">Type your full name to sign</span>
              <input
                autoComplete="name"
                className="kit-input"
                onChange={(event) => setTypedName(event.target.value)}
                value={typedName}
              />
            </label>
            {error ? (
              <p className="kit-error" role="alert">
                {error}
              </p>
            ) : null}
            <Button disabled={busy || !consented || normaliseTypedName(typedName) === null} onClick={() => void sign()}>
              {busy ? "Signing…" : "Sign the change"}
            </Button>
          </div>
        </KitRoot>
      </SheetDialog>
    </Card>
  );
}
