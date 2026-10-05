"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { CheckCircle2, LoaderCircle, Receipt } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { basisPointsToPercent, percentToBasisPoints } from "@/features/billing/sales-tax-settings";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  quickBooksSetupAvailable,
  readQuickBooksSetup,
  saveBillingSettings,
  type QuickBooksSetupStatus,
} from "@/lib/integrations/quickbooks-setup-client";

/**
 * "Your QuickBooks charges sales tax. Add it on top of your prices?"
 *
 * Gabe, 2026-10-05: his QuickBooks charges sales tax and StudioCue knew it
 * (it reads TaxPrefs), but the choice sat pre-selected and unsaved on a
 * settings page he had no reason to open, so every invoice went out with $0
 * tax. The answer is the studio's — whether its prices already include tax is
 * something only it knows — so it is asked, once, where the studio already is:
 * on the QuickBooks page after connecting, at the end of setup, and on Today.
 *
 * Asked only when QuickBooks is connected, charges tax, and nothing has been
 * saved. Saving keeps the studio's other billing setting as it was.
 */
export function SalesTaxDecision({
  status,
  tenantId,
  onSaved,
  compact = false,
}: {
  status: QuickBooksSetupStatus;
  tenantId: string;
  onSaved?: () => void;
  compact?: boolean;
}) {
  const [choice, setChoice] = useState<"add" | null>(null);
  const [rate, setRate] = useState(basisPointsToPercent(status.company?.suggestedEstimateRateBasisPoints ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"quickbooks" | "none" | null>(null);
  const rateBasisPoints = percentToBasisPoints(rate);
  const rateInvalid = rate.trim() !== "" && rateBasisPoints === null;

  async function save(mode: "quickbooks" | "none") {
    if (mode === "quickbooks" && rateInvalid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveBillingSettings(tenantId, {
        salesTax: { mode, estimateRateBasisPoints: mode === "quickbooks" ? rateBasisPoints : null },
        holdRetainerForReview: status.settings.holdRetainerForReview,
      });
      if (!result.persisted) {
        setError("Preview mode: nothing was saved.");
        return;
      }
      setDone(mode);
      onSaved?.();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That couldn't be saved. Try again, or use Settings → Integrations → QuickBooks."));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className={`sales-tax-question is-done${compact ? " is-compact" : ""}`} role="status">
        <CheckCircle2 aria-hidden="true" size={18} />
        <p>
          {done === "quickbooks"
            ? "Sales tax is on. Proposals show your prices plus sales tax, QuickBooks works out the tax on each final invoice, and clients give their billing address when they sign."
            : "Got it — your prices include tax, so StudioCue won't add any."}
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="sales-tax-question-title" className={`sales-tax-question${compact ? " is-compact" : ""}`}>
      <div className="sales-tax-question-head">
        <span aria-hidden="true" className="sales-tax-question-icon">
          <Receipt size={18} />
        </span>
        <div>
          <h2 id="sales-tax-question-title">Your QuickBooks charges sales tax. Add it on top of your prices?</h2>
          <p>
            StudioCue isn&rsquo;t adding it yet, so invoices go out without tax. If your package prices don&rsquo;t include
            tax, add it: proposals read &ldquo;plus sales tax&rdquo; and QuickBooks works out the exact amount on each final
            invoice from the client&rsquo;s address.
          </p>
          {status.company?.salesTax === "manual" ? (
            <p className="sales-tax-question-note">
              QuickBooks works tax out from each address only with Automated Sales Tax on.{" "}
              <Link href="/studio/integrations?tab=quickbooks">Here&rsquo;s how to turn it on</Link>.
            </p>
          ) : null}
        </div>
      </div>
      {choice === "add" ? (
        <div className="sales-tax-question-rate">
          <label>
            <span>Estimate to show on proposals (optional)</span>
            <span className="sales-tax-question-rate-input">
              <input
                aria-invalid={rateInvalid}
                inputMode="decimal"
                onChange={(event) => setRate(event.target.value)}
                placeholder="e.g. 6.625"
                value={rate}
              />
              <span aria-hidden="true">%</span>
            </span>
            <small>Your state&rsquo;s rate is a good estimate. The tax actually charged is QuickBooks&rsquo;, per address.</small>
          </label>
          {rateInvalid ? <p className="form-error">Enter a rate like 6.625.</p> : null}
        </div>
      ) : null}
      <div className="sales-tax-question-actions">
        {choice === "add" ? (
          <button className="button button-dark" disabled={busy || rateInvalid} onClick={() => void save("quickbooks")} type="button">
            {busy ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : null}
            Turn on sales tax
          </button>
        ) : (
          <button className="button button-dark" disabled={busy} onClick={() => setChoice("add")} type="button">
            Yes, add it on top
          </button>
        )}
        <button className="button button-light" disabled={busy} onClick={() => void save("none")} type="button">
          No, my prices include it
        </button>
        {compact ? (
          <Link className="text-link" href="/studio/integrations">
            More QuickBooks settings
          </Link>
        ) : null}
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The question for Today and the end of setup: it loads its own answer, and
 * renders nothing for a studio it doesn't apply to. QuickBooks is read only
 * when the two cheap checks pass — connected, and no choice saved.
 */
export function SalesTaxQuestion({ compact = true }: { compact?: boolean }) {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const owner = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const [status, setStatus] = useState<QuickBooksSetupStatus | null>(null);

  useEffect(() => {
    if (!dataIsLive || !owner || !tenantId || !quickBooksSetupAvailable()) return;
    let live = true;
    (async () => {
      try {
        const { firestore } = getFirebaseClient();
        // A studio that has never saved billing settings has no record, and
        // the rule (which reads the record's tenantId) refuses a read of a
        // missing one. Refused or absent both mean "nothing saved" — which is
        // exactly the new studio this question is for. The same goes for a
        // QuickBooks connection that doesn't exist: not connected.
        const [settings, connection] = await Promise.all([
          getDoc(doc(firestore, "billingSettings", tenantId)).catch(() => null),
          getDoc(doc(firestore, "integrationConnections", `${tenantId}_quickbooks`)).catch(() => null),
        ]);
        const salesTax = settings?.exists() ? (settings.get("salesTax") as { mode?: unknown } | undefined) : undefined;
        if (salesTax && "mode" in salesTax) return;
        if (!connection?.exists() || connection.get("status") !== "connected" || connection.get("archivedAt")) return;
        const next = await readQuickBooksSetup(tenantId);
        if (live && next.connected && !next.settingsSaved && next.company && next.company.salesTax !== "off") setStatus(next);
      } catch {
        // Nothing to ask is the safe reading of a failed look-up: the settings
        // page still has the question.
      }
    })();
    return () => {
      live = false;
    };
  }, [owner, tenantId]);

  if (!status || !tenantId) return null;
  return <SalesTaxDecision compact={compact} status={status} tenantId={tenantId} />;
}
