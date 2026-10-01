"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleMinus, LoaderCircle, ReceiptText, TriangleAlert, XCircle } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  basisPointsToPercent,
  percentToBasisPoints,
  type SalesTaxMode,
} from "@/features/billing/sales-tax-settings";
import {
  quickBooksSetupAvailable,
  readQuickBooksSetup,
  saveBillingSettings,
  sendQuickBooksTestInvoice,
  setUpQuickBooksItems,
  type QuickBooksSetupStatus,
  type QuickBooksTestResult,
} from "@/lib/integrations/quickbooks-setup-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Settings → Integrations → QuickBooks: run QuickBooks without leaving
 * StudioCue. QuickBooks is the sales-tax authority (its Automated Sales Tax
 * works the tax out from the couple's address); this page says what the
 * connected company does, saves the studio's choices to billingSettings, sets
 * up the two items invoices use, and proves the whole path with a $1.00 test
 * invoice that is voided straight away.
 */

const SALES_TAX_WORDS: Record<string, string> = {
  automatic: "Automatic — QuickBooks works it out from each client's address",
  manual: "Manual — QuickBooks uses the rates you set up yourself",
  off: "Off — QuickBooks isn't set up to charge sales tax",
};

const PAYMENTS_WORDS: Record<string, string> = {
  on: "On — clients can pay invoices online",
  off: "Not set up — invoices have no pay-online link",
  unknown: "Not checked yet — send a test invoice to find out",
};

function errorWords(caught: unknown, fallback: string): string {
  const code = caught instanceof Error ? caught.message : "";
  if (code === "PREVIEW_MODE") return "Preview mode: QuickBooks isn't reachable from here, and nothing was saved.";
  if (code.endsWith("_NOT_CONNECTED")) return "Connect QuickBooks on the Connections tab first.";
  if (code === "QUICKBOOKS_INCOME_ACCOUNT_MISSING")
    return "Your QuickBooks has no income account to post the items to. Add one in QuickBooks (Chart of accounts), then try again.";
  if (/^QUICKBOOKS_[A-Z_]+:\d+:/.test(code)) return `QuickBooks said: ${code.split(":").slice(2).join(":").trim()}`;
  return friendlyError(caught, fallback);
}

function CheckIcon({ ok }: { ok: boolean | null }) {
  if (ok === true) return <CheckCircle2 aria-label="Passed" className="qb-check-icon is-ok" size={16} />;
  if (ok === false) return <XCircle aria-label="Failed" className="qb-check-icon is-failed" size={16} />;
  return <CircleMinus aria-label="Not checked" className="qb-check-icon" size={16} />;
}

export function QuickBooksSettings() {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const allowed = ["studio_owner", "studio_admin"].includes(String(workspace.role));
  const [status, setStatus] = useState<QuickBooksSetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "items" | "test" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<SalesTaxMode>("none");
  const [rate, setRate] = useState("");
  const [holdRetainer, setHoldRetainer] = useState(false);
  const [test, setTest] = useState<QuickBooksTestResult | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    if (!quickBooksSetupAvailable()) {
      setLoading(false);
      setNotice("Preview mode: QuickBooks isn't reachable from here, and nothing will be saved.");
      return;
    }
    setLoading(true);
    try {
      const next = await readQuickBooksSetup(tenantId);
      setStatus(next);
      setMode(next.settings.salesTax.mode);
      setRate(
        basisPointsToPercent(
          next.settings.salesTax.estimateRateBasisPoints ?? next.company?.suggestedEstimateRateBasisPoints ?? null,
        ),
      );
      setHoldRetainer(next.settings.holdRetainerForReview);
      setTest(next.lastTest);
    } catch (caught: unknown) {
      setNotice(errorWords(caught, "QuickBooks couldn't be read."));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (!tenantId || !allowed) return null;

  const rateBasisPoints = percentToBasisPoints(rate);
  const rateInvalid = rate.trim() !== "" && rateBasisPoints === null;
  const company = status?.company ?? null;
  const itemsReady = Boolean(status?.items.stored);

  async function save() {
    if (rateInvalid) return;
    setBusy("save");
    setNotice(null);
    try {
      const result = await saveBillingSettings(tenantId!, {
        salesTax: { mode, estimateRateBasisPoints: mode === "quickbooks" ? rateBasisPoints : null },
        holdRetainerForReview: holdRetainer,
      });
      setNotice(result.persisted ? "Saved." : "Preview mode: nothing was saved.");
      if (result.persisted) await load();
    } catch (caught: unknown) {
      setNotice(errorWords(caught, "Your billing settings couldn't be saved."));
    } finally {
      setBusy(null);
    }
  }

  async function items() {
    setBusy("items");
    setNotice(null);
    try {
      const result = await setUpQuickBooksItems(tenantId!);
      setNotice(
        result.created.length
          ? `Made ${result.created.length === 2 ? "both items" : "the missing item"} in QuickBooks.`
          : "Your QuickBooks already had both items; StudioCue will use them.",
      );
      await load();
    } catch (caught: unknown) {
      setNotice(errorWords(caught, "The items couldn't be set up."));
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setNotice(null);
    try {
      const result = await sendQuickBooksTestInvoice(tenantId!);
      setTest(result);
      await load();
    } catch (caught: unknown) {
      setNotice(errorWords(caught, "The test invoice couldn't be sent."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="autopay-settings" aria-labelledby="quickbooks-settings-heading">
      <header className="autopay-head">
        <div>
          <h2 id="quickbooks-settings-heading">
            <ReceiptText aria-hidden="true" size={17} /> QuickBooks
          </h2>
          <p>
            StudioCue makes your invoices in QuickBooks. QuickBooks works out
            the sales tax, and you confirm it on each final invoice before it
            goes.
          </p>
        </div>
        <span className={status?.connected ? "autopay-state is-on" : "autopay-state"}>
          {loading ? "Checking…" : status?.connected ? (status.mock ? "Connected (test mode)" : "Connected") : "Not connected"}
        </span>
      </header>

      {loading ? (
        <p className="agreement-template-state">
          <LoaderCircle className="spin" size={15} /> Reading your QuickBooks…
        </p>
      ) : status && !status.connected ? (
        <p className="agreement-template-state is-attention" role="alert">
          <TriangleAlert size={15} /> Connect QuickBooks on the Connections tab first.{" "}
          {status.error ? `(${status.error})` : ""}
        </p>
      ) : status ? (
        <>
          {status.error ? (
            <p className="agreement-template-state is-attention" role="alert">
              <TriangleAlert size={15} /> QuickBooks couldn&rsquo;t be read just now ({status.error}). Your saved settings are below.
            </p>
          ) : null}
          <dl className="qb-settings-status">
            <div>
              <dt>Company</dt>
              <dd>{company?.companyName ?? "Unknown"}</dd>
            </div>
            <div>
              <dt>Sales tax in QuickBooks</dt>
              <dd>{company ? SALES_TAX_WORDS[company.salesTax] : "Unknown"}</dd>
            </div>
            <div>
              <dt>QuickBooks Payments</dt>
              <dd>{company ? PAYMENTS_WORDS[company.payments.state] : "Unknown"}</dd>
            </div>
            <div>
              <dt>Items on your invoices</dt>
              <dd>
                {itemsReady
                  ? `${status.items.retainer?.name} and ${status.items.package?.name}`
                  : status.items.retainer || status.items.package
                    ? "Found in QuickBooks — not set up for StudioCue yet"
                    : "Not set up yet"}
              </dd>
            </div>
          </dl>

          <fieldset className="qb-settings-section">
            <legend>Sales tax on your invoices</legend>
            {!status.settingsSaved && company && company.salesTax !== "off" ? (
              <p className="qb-settings-hint">Your QuickBooks charges sales tax, so we&rsquo;ve suggested adding it. Save to confirm.</p>
            ) : null}
            <label className="autopay-toggle">
              <input checked={mode === "quickbooks"} name="sales-tax-mode" onChange={() => setMode("quickbooks")} type="radio" />
              <span>Add sales tax (QuickBooks calculates it)</span>
            </label>
            <label className="autopay-toggle">
              <input checked={mode === "none"} name="sales-tax-mode" onChange={() => setMode("none")} type="radio" />
              <span>Don&rsquo;t add sales tax</span>
            </label>
            {mode === "quickbooks" && company && company.salesTax !== "automatic" ? (
              <p className="qb-settings-hint is-attention">
                QuickBooks only works out tax from each client&rsquo;s address when Automated Sales Tax is on. Turn it on in
                QuickBooks under Taxes → Sales tax.
              </p>
            ) : null}
            {mode === "quickbooks" ? (
              <label className="qb-settings-rate">
                <span>Estimated rate for proposals</span>
                <span className="qb-settings-rate-input">
                  <input
                    aria-invalid={rateInvalid}
                    inputMode="decimal"
                    onChange={(event) => setRate(event.target.value)}
                    placeholder="e.g. 8.25"
                    value={rate}
                  />
                  %
                </span>
                <small>
                  {rateInvalid
                    ? "Enter a rate between 0 and 25, like 8.25."
                    : "Proposals show tax at this rate as an estimate. The final invoice uses QuickBooks' figure for the couple's address."}
                </small>
              </label>
            ) : null}
            <label className="autopay-toggle">
              <input checked={holdRetainer} onChange={(event) => setHoldRetainer(event.target.checked)} type="checkbox" />
              <span>Hold retainer invoices for my review before they go</span>
            </label>
            <div>
              <button className="button button-dark" disabled={busy !== null || rateInvalid} onClick={() => void save()} type="button">
                {busy === "save" ? <LoaderCircle className="spin" size={14} /> : null}
                Save
              </button>
            </div>
          </fieldset>

          <fieldset className="qb-settings-section">
            <legend>Items</legend>
            <p className="qb-settings-hint">
              Every line StudioCue puts on an invoice is sold as one of two QuickBooks items: &ldquo;Retainer&rdquo; (no
              sales tax) and &ldquo;Photography package&rdquo; (taxable). Items you already have with those names are
              used as they are. If you skip this, it happens on your first invoice.
            </p>
            <div>
              <button className="button button-light" disabled={busy !== null} onClick={() => void items()} type="button">
                {busy === "items" ? <LoaderCircle className="spin" size={14} /> : null}
                {itemsReady ? "Check StudioCue items" : "Set up StudioCue items"}
              </button>
            </div>
          </fieldset>

          <fieldset className="qb-settings-section">
            <legend>Send a test invoice</legend>
            <p className="qb-settings-hint">
              Makes a $1.00 invoice to &ldquo;StudioCue test (you)&rdquo; at your own email, checks QuickBooks adds the tax
              and a pay-online link, then voids it. Nothing is emailed to anyone.
            </p>
            <div>
              <button className="button button-light" disabled={busy !== null} onClick={() => void runTest()} type="button">
                {busy === "test" ? <LoaderCircle className="spin" size={14} /> : null}
                Send a test invoice
              </button>
            </div>
            {test ? (
              <div className="qb-test-result" role="status">
                <p className={test.passed ? "agreement-template-state" : "agreement-template-state is-attention"}>
                  {test.passed ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />}
                  {test.passed ? "Everything worked." : "Something needs a look."}{" "}
                  {new Date(test.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  {test.mock ? " (test mode — QuickBooks wasn't contacted)" : ""}
                </p>
                <ul className="qb-test-checks">
                  {test.checks.map((check) => (
                    <li key={check.key}>
                      <CheckIcon ok={check.ok} />
                      <span>
                        <strong>{check.label}</strong> {check.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>
        </>
      ) : null}

      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
