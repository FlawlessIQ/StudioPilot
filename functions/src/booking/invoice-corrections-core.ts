import { isStandingInvoice } from "./invoice-standing.js";

/**
 * Voiding an invoice, and correcting a payment a person recorded.
 *
 * Found in the money audit of 2026-09-30 (wave 1). StudioCue could raise a bill
 * and record a payment, and could take back neither. `voided` only ever arrived
 * by webhook, so the copy that told a studio to "void it first" pointed at a
 * button that did not exist; and a payment recorded against the wrong job, on
 * the wrong day or for money that never came could not be fixed at all.
 *
 * Both corrections are made by adding, never by rewriting: a void keeps the
 * invoice with its reason, and a corrected payment appends a record that
 * supersedes the one before it, leaving the original attestation as it was.
 *
 * Pure. The functions copy: features/booking/invoice-corrections.ts is the
 * source of truth; tests/wave1-money.test.ts fails on a drift.
 */

export type CorrectableInvoice = {
  status?: unknown;
  kind?: unknown;
  amountCents?: unknown;
  balanceCents?: unknown;
  provider?: unknown;
  providerInvoiceId?: unknown;
  providerState?: unknown;
  completionAuthority?: unknown;
  completionEvidence?: unknown;
  paymentCorrections?: unknown;
  // Any stored invoice record: the rules read only the fields above.
  [field: string]: unknown;
};

const STUDIO_VOUCHED = new Set(["manual_attested", "imported"]);

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Paid so far on one invoice. */
export function paidOnInvoice(invoice: CorrectableInvoice): number {
  const amount = num(invoice.amountCents);
  const balance = invoice.balanceCents == null ? amount : num(invoice.balanceCents);
  return Math.max(0, amount - balance);
}

/**
 * Raised at the provider: there is a real invoice there to void, and its
 * balance is the one QuickBooks or Stripe will act on.
 */
export function invoiceAtProvider(invoice: CorrectableInvoice): boolean {
  const id = typeof invoice.providerInvoiceId === "string" ? invoice.providerInvoiceId : "";
  return invoice.providerState === "completed" && id.length > 0 && !id.startsWith("pending_");
}

/**
 * Why this invoice cannot be voided, or null.
 *
 * Money on it is the line: a void would take a payment off the books with it,
 * and whether to refund that is the studio's decision under its own agreement,
 * made where the money is. A payment typed in error is corrected instead.
 */
export function invoiceVoidRefusal(invoice: CorrectableInvoice): string | null {
  const status = String(invoice.status ?? "");
  if (!isStandingInvoice(status) || status === "void" || status === "cancelled")
    return "INVOICE_NOT_VOIDABLE";
  if (status === "paid" || paidOnInvoice(invoice) > 0) return "INVOICE_HAS_PAYMENT";
  return null;
}

/**
 * Whether the payment on this invoice is one a person recorded, and so one a
 * person may correct.
 *
 * A payment QuickBooks or Stripe confirmed is theirs to correct: StudioCue
 * follows the provider, and would be overwritten by its next sync anyway. A
 * payment put back to "not paid" by an earlier correction stays correctable
 * until the provider reports it paid.
 */
export function paymentCorrectable(invoice: CorrectableInvoice): boolean {
  if (STUDIO_VOUCHED.has(String(invoice.completionAuthority))) return true;
  const corrected = Array.isArray(invoice.paymentCorrections) && invoice.paymentCorrections.length > 0;
  const status = String(invoice.status ?? "");
  return corrected && isStandingInvoice(status) && status !== "paid";
}

/** Open statuses a provider invoice can be put back to when its payment is withdrawn. */
const REOPENABLE = new Set(["sent", "awaiting_delivery", "overdue"]);

export type PaymentCorrection = {
  amountCents: number;
  /** yyyy-mm-dd; ignored when the amount is zero. */
  paidAt: string;
  method: string;
  reference: string | null;
  reason: string;
};

export type PaymentCorrectionPlan =
  | { ok: false; code: string }
  | {
      ok: true;
      paidCents: number;
      /** The invoice's current fields after the correction. */
      fields: {
        status: string;
        balanceCents: number;
        completionAuthority: string | null;
        paidAt: string | null;
      };
      /** A provider invoice back to unpaid: re-read its balance from the provider. */
      reopenedAtProvider: boolean;
    };

/**
 * What a corrected payment makes of the invoice. Pure; the caller appends the
 * correction record beside it.
 *
 * Partial amounts are accepted only for a record StudioCue keeps alone (a
 * payment recorded by hand, or imported). On an invoice the provider holds,
 * its balance is the one autopay charges and the one every sync reports, and
 * the provider never saw this payment. A part payment there is withdrawn to
 * nothing here and recorded with recordInvoicePayment (invoice-payments),
 * which records it at the provider too.
 */
export function planPaymentCorrection(
  invoice: CorrectableInvoice,
  input: PaymentCorrection,
): PaymentCorrectionPlan {
  if (!paymentCorrectable(invoice)) return { ok: false, code: "PAYMENT_NOT_STUDIO_RECORDED" };
  const amount = num(invoice.amountCents);
  const paid = input.amountCents;
  if (!Number.isSafeInteger(paid) || paid < 0) return { ok: false, code: "PAYMENT_AMOUNT_INVALID" };
  if (paid > amount) return { ok: false, code: "PAYMENT_EXCEEDS_INVOICE" };
  const atProvider = invoiceAtProvider(invoice);
  if (atProvider && paid > 0 && paid < amount) return { ok: false, code: "PARTIAL_PAYMENT_AT_PROVIDER" };
  const authority = String(invoice.completionAuthority ?? "");
  const paidAt = `${input.paidAt}T00:00:00.000Z`;
  if (paid === amount && amount > 0)
    return {
      ok: true,
      paidCents: paid,
      fields: {
        status: "paid",
        balanceCents: 0,
        // Still a person's word, not a provider's.
        completionAuthority: STUDIO_VOUCHED.has(authority) ? authority : "manual_attested",
        paidAt,
      },
      reopenedAtProvider: false,
    };
  if (paid > 0)
    return {
      ok: true,
      paidCents: paid,
      // No authority: the booking gate reads a studio-vouched authority as
      // "the retainer is paid", and a part payment is not that.
      fields: { status: "partially_paid", balanceCents: amount - paid, completionAuthority: null, paidAt },
      reopenedAtProvider: false,
    };
  if (atProvider) {
    const evidence = (invoice.completionEvidence ?? {}) as { priorStatus?: unknown };
    const prior = String(evidence.priorStatus ?? "");
    return {
      ok: true,
      paidCents: 0,
      fields: {
        status: REOPENABLE.has(prior) ? prior : "sent",
        balanceCents: amount,
        completionAuthority: null,
        paidAt: null,
      },
      reopenedAtProvider: true,
    };
  }
  // A record StudioCue kept alone, of money that never came: nothing stands
  // behind it, so it stops counting, and the retainer or balance is owed again.
  return {
    ok: true,
    paidCents: 0,
    fields: { status: "voided", balanceCents: amount, completionAuthority: null, paidAt: null },
    reopenedAtProvider: false,
  };
}
