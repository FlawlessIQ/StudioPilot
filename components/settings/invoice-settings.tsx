"use client";

import { useState } from "react";
import { CheckCircle2, FileText, LoaderCircle, ReceiptText } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  PAYMENT_INSTRUCTION_PICKS,
  STUDIO_INVOICE_MAX_DUE_DAYS,
  STUDIO_INVOICE_TEXT_LIMITS,
  normalisePayLink,
  normaliseStudioInvoiceSettings,
  normaliseTaxRate,
  type StudioInvoiceSettings,
} from "@/features/billing/studio-invoice-settings";
import { basisPointsToPercent, percentToBasisPoints } from "@/features/billing/sales-tax-settings";
import { previewStudioInvoicePdf, saveStudioInvoiceSettings } from "@/lib/billing/studio-invoice-client";
import { friendlyError } from "@/lib/ai/friendly-error";

type Draft = {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  paymentInstructions: string;
  payLinkUrl: string;
  dueDays: string;
  taxPercent: string;
  taxLabel: string;
  footer: string;
};

function draftFrom(settings: StudioInvoiceSettings): Draft {
  return {
    businessName: settings.businessName ?? "",
    businessAddress: settings.businessAddress ?? "",
    businessEmail: settings.businessEmail ?? "",
    businessPhone: settings.businessPhone ?? "",
    paymentInstructions: settings.paymentInstructions ?? "",
    payLinkUrl: settings.payLinkUrl ?? "",
    dueDays: String(settings.dueDays),
    taxPercent: basisPointsToPercent(settings.tax.rateBasisPoints),
    taxLabel: settings.tax.label ?? "",
    footer: settings.footer ?? "",
  };
}

const orNull = (value: string) => (value.trim() ? value.trim() : null);

/**
 * Settings → Invoices: what goes on the invoices StudioCue issues when a
 * studio bills a job itself (features/billing/studio-invoice-settings.ts),
 * and how its clients pay. A studio with no QuickBooks bills every job this
 * way; one with QuickBooks chooses per job (features/billing/job-billing.ts).
 * QuickBooks' own tax settings stay under Integrations → QuickBooks.
 */
export function InvoiceSettings() {
  const workspace = useWorkspace();
  const ownerOrAdmin = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records } = useTenantDocuments("billingSettings", { enabled: ownerOrAdmin });
  const stored = normaliseStudioInvoiceSettings(
    records?.find((record) => record.tenantId === workspace.tenantId) ?? null,
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  /** The rendered sample, when the browser wouldn't open a tab for it. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  /** Edited since the last save: the sample shows saved details only. */
  const [dirty, setDirty] = useState(false);

  if (!ownerOrAdmin) {
    return <p className="form-notice">Only a studio owner or admin can change your invoice details.</p>;
  }

  const current = draft ?? draftFrom(stored);
  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...current, ...patch });
    setDirty(true);
    setSaved(null);
    setError(null);
  };

  async function save() {
    const payLink = current.payLinkUrl.trim();
    if (payLink && !normalisePayLink(payLink)) {
      setError("The payment link needs to be a full web address starting with https://.");
      return;
    }
    const dueDays = Math.round(Number(current.dueDays));
    if (!Number.isFinite(dueDays) || dueDays < 0 || dueDays > STUDIO_INVOICE_MAX_DUE_DAYS) {
      setError(`Invoices are due between 0 and ${STUDIO_INVOICE_MAX_DUE_DAYS} days after they're sent.`);
      return;
    }
    const taxRate = current.taxPercent.trim() ? percentToBasisPoints(current.taxPercent) : null;
    if (current.taxPercent.trim() && normaliseTaxRate(taxRate) === null) {
      setError("Enter the sales tax as a percentage between 0 and 25, like 8.25 — or leave it blank for none.");
      return;
    }
    if (!workspace.tenantId) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await saveStudioInvoiceSettings(workspace.tenantId, {
        businessName: orNull(current.businessName),
        businessAddress: orNull(current.businessAddress),
        businessEmail: orNull(current.businessEmail),
        businessPhone: orNull(current.businessPhone),
        paymentInstructions: orNull(current.paymentInstructions),
        payLinkUrl: orNull(payLink),
        dueDays,
        tax: { rateBasisPoints: normaliseTaxRate(taxRate), label: orNull(current.taxLabel) },
        footer: orNull(current.footer),
      });
      if (!result.persisted) {
        setSaved("Preview mode: your invoice details were not saved.");
        return;
      }
      refreshTenantRecords("billingSettings");
      if (result.settings) setDraft(draftFrom(result.settings));
      setDirty(false);
      setSaved("Saved. Invoices you send from now on use these details.");
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Your invoice details couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The studio's saved details on a sample invoice, rendered exactly as a
   * client's would be. The tab opens on the tap, before the await, or the
   * browser blocks it as a pop-up.
   */
  async function preview() {
    if (!workspace.tenantId) return;
    setPreviewing(true);
    setError(null);
    const tab = window.open("", "_blank");
    try {
      const pdf = await previewStudioInvoicePdf(workspace.tenantId);
      if (!pdf) {
        tab?.close();
        setSaved("Preview mode: there's no invoice PDF to show here.");
        return;
      }
      const url = URL.createObjectURL(pdf);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (tab) {
        tab.location.href = url;
        setPreviewUrl(null);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        // Pop-ups blocked: a plain link still opens it on a tap.
        setPreviewUrl(url);
      }
    } catch (caught: unknown) {
      tab?.close();
      setError(friendlyError(caught, "The sample invoice couldn't be made."));
    } finally {
      setPreviewing(false);
    }
  }

  const limits = STUDIO_INVOICE_TEXT_LIMITS;
  return (
    <section aria-labelledby="invoice-settings-title" className="panel invoice-settings">
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="email-branding-heading">
          <span className="data-control-icon">
            <ReceiptText aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Billing</p>
            <h2 id="invoice-settings-title">Invoices and payments</h2>
            <p>
              What your invoices say and how clients pay you, for every job you bill yourself. With QuickBooks
              connected, you choose on each job whether QuickBooks bills it instead.
            </p>
          </div>
        </div>

        <h3 className="invoice-settings-subhead">Your business</h3>
        <div className="crm-form-grid invoice-settings-grid">
          <label>
            Business name
            <input
              maxLength={limits.businessName}
              onChange={(event) => edit({ businessName: event.target.value })}
              placeholder={workspace.tenantName}
              value={current.businessName}
            />
            <small>Leave blank to use your studio name.</small>
          </label>
          <label>
            Email for billing questions
            <input
              maxLength={limits.businessEmail}
              onChange={(event) => edit({ businessEmail: event.target.value })}
              type="email"
              value={current.businessEmail}
            />
          </label>
          <label>
            Phone
            <input
              maxLength={limits.businessPhone}
              onChange={(event) => edit({ businessPhone: event.target.value })}
              type="tel"
              value={current.businessPhone}
            />
          </label>
          <label className="form-span">
            Business address
            <textarea
              maxLength={limits.businessAddress}
              onChange={(event) => edit({ businessAddress: event.target.value })}
              rows={3}
              value={current.businessAddress}
            />
          </label>
        </div>

        <h3 className="invoice-settings-subhead">How clients pay you</h3>
        <div className="crm-form-grid invoice-settings-grid">
          <label className="form-span">
            Payment instructions
            <textarea
              maxLength={limits.paymentInstructions}
              onChange={(event) => edit({ paymentInstructions: event.target.value })}
              placeholder="Zelle to billing@yourstudio.com, or checks payable to Your Studio LLC"
              rows={3}
              value={current.paymentInstructions}
            />
            <small>Printed on every invoice and shown to the client with what they owe.</small>
          </label>
          <div className="invoice-settings-picks form-span" role="group" aria-label="Add a payment method">
            {PAYMENT_INSTRUCTION_PICKS.map((pick) => (
              <button
                className="button button-light button-sm"
                key={pick.id}
                onClick={() =>
                  edit({
                    paymentInstructions: current.paymentInstructions.trim()
                      ? `${current.paymentInstructions.trimEnd()}\n${pick.text}`
                      : pick.text,
                  })
                }
                type="button"
              >
                + {pick.label}
              </button>
            ))}
          </div>
          <label className="form-span">
            Payment link (optional)
            <input
              inputMode="url"
              maxLength={limits.payLinkUrl}
              onChange={(event) => edit({ payLinkUrl: event.target.value })}
              placeholder="https://"
              value={current.payLinkUrl}
            />
            <small>Your own Square, PayPal or Stripe link. Clients get a Pay button that opens it.</small>
          </label>
          <label>
            Due after (days)
            <input
              max={STUDIO_INVOICE_MAX_DUE_DAYS}
              min={0}
              onChange={(event) => edit({ dueDays: event.target.value })}
              type="number"
              value={current.dueDays}
            />
            <small>When nothing agreed sets the date. 0 means due on receipt.</small>
          </label>
        </div>

        <h3 className="invoice-settings-subhead">Sales tax and footer</h3>
        <div className="crm-form-grid invoice-settings-grid">
          <label>
            Sales tax (%)
            <input
              inputMode="decimal"
              onChange={(event) => edit({ taxPercent: event.target.value })}
              placeholder="None"
              value={current.taxPercent}
            />
            <small>Added to invoices you send yourself. QuickBooks jobs use QuickBooks&rsquo; tax.</small>
          </label>
          <label>
            Tax label
            <input
              maxLength={limits.taxLabel}
              onChange={(event) => edit({ taxLabel: event.target.value })}
              placeholder="Sales tax"
              value={current.taxLabel}
            />
          </label>
          <label className="form-span">
            Footer (optional)
            <textarea
              maxLength={limits.footer}
              onChange={(event) => edit({ footer: event.target.value })}
              placeholder="Thank you! A 2% fee applies to card payments."
              rows={2}
              value={current.footer}
            />
          </label>
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="form-notice" role="status">
            <CheckCircle2 size={15} /> {saved}
          </p>
        ) : null}
        <div className="invoice-settings-actions">
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" size={16} /> : null}
            Save
          </button>
          <button className="button button-light" disabled={previewing || busy} onClick={() => void preview()} type="button">
            {previewing ? <LoaderCircle className="spin" size={16} /> : <FileText size={16} />}
            Preview a sample invoice
          </button>
          {previewUrl ? (
            <a className="button button-light" href={previewUrl} rel="noreferrer" target="_blank">
              Open the sample invoice
            </a>
          ) : null}
          {dirty ? <small>The sample shows your saved details. Save first to see your changes.</small> : null}
        </div>
      </form>
    </section>
  );
}
