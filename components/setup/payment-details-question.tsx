"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, LoaderCircle, ReceiptText } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  PAYMENT_INSTRUCTION_PICKS,
  STUDIO_INVOICE_TEXT_LIMITS,
  normalisePayLink,
  normaliseStudioInvoiceSettings,
  studioInvoicePaymentReady,
} from "@/features/billing/studio-invoice-settings";
import { saveStudioInvoiceSettings } from "@/lib/billing/studio-invoice-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Setup: "How do clients pay you?" (own invoicing, Phase 6).
 *
 * Not one of the counted setup questions — like the sales tax question
 * beside it. Asked of an owner or admin whose studio hasn't said how clients
 * pay, because every invoice StudioCue sends for it says so (an invoice that
 * didn't left Riley Park with no way to pay, 2026-10-10). The rest of the
 * invoice details live in Settings → Invoices and payments.
 */
export function PaymentDetailsQuestion() {
  const workspace = useWorkspace();
  const ownerOrAdmin = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records } = useTenantDocuments("billingSettings", { enabled: ownerOrAdmin });
  const [instructions, setInstructions] = useState("");
  const [payLink, setPayLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!ownerOrAdmin || !workspace.tenantId || records === null) return null;
  const stored = normaliseStudioInvoiceSettings(records.find((record) => record.tenantId === workspace.tenantId) ?? null);
  if (studioInvoicePaymentReady(stored) && !saved) return null;

  async function save() {
    const link = payLink.trim();
    if (link && !normalisePayLink(link)) {
      setError("The payment link needs to be a full web address starting with https://.");
      return;
    }
    if (!instructions.trim() && !link) {
      setError("Add how clients pay you, or a payment link.");
      return;
    }
    if (!workspace.tenantId) return;
    setBusy(true);
    setError(null);
    try {
      // Everything else on the invoice stays as it was saved.
      await saveStudioInvoiceSettings(workspace.tenantId, {
        ...stored,
        paymentInstructions: instructions.trim() || null,
        payLinkUrl: link || null,
      });
      refreshTenantRecords("billingSettings");
      setSaved(true);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "Your payment details couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <section className="panel setup-payment-details">
        <p className="form-notice" role="status">
          <CheckCircle2 size={15} /> Saved. Every invoice you send says how to pay.{" "}
          <Link href="/studio/settings/invoices">Add your business details</Link>.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="setup-payment-details-title" className="panel setup-payment-details">
      <div className="setup-payment-details-head">
        <ReceiptText aria-hidden size={18} />
        <h2 id="setup-payment-details-title">How do clients pay you?</h2>
      </div>
      <p>
        StudioCue sends your deposit and final invoices for you, and each one says how to pay. With QuickBooks
        connected you can bill through it instead, job by job.
      </p>
      <label className="setup-payment-details-field">
        Payment instructions
        <textarea
          maxLength={STUDIO_INVOICE_TEXT_LIMITS.paymentInstructions}
          onChange={(event) => setInstructions(event.target.value)}
          placeholder="Zelle to billing@yourstudio.com, or checks payable to Your Studio LLC"
          rows={3}
          value={instructions}
        />
      </label>
      <div className="invoice-settings-picks" role="group" aria-label="Add a payment method">
        {PAYMENT_INSTRUCTION_PICKS.map((pick) => (
          <button
            className="button button-light button-sm"
            key={pick.id}
            onClick={() => setInstructions((current) => (current.trim() ? `${current.trimEnd()}\n${pick.text}` : pick.text))}
            type="button"
          >
            + {pick.label}
          </button>
        ))}
      </div>
      <label className="setup-payment-details-field">
        Payment link (optional)
        <input inputMode="url" onChange={(event) => setPayLink(event.target.value)} placeholder="https://" value={payLink} />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="button button-dark" disabled={busy} onClick={() => void save()} type="button">
        {busy ? <LoaderCircle className="spin" size={16} /> : null}
        Save
      </button>
    </section>
  );
}
