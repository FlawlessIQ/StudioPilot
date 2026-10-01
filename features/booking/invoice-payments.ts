import { invoiceAtProvider } from "./invoice-corrections";
import { invoiceClosedToProviderWork, isStandingInvoice } from "./invoice-standing";

/**
 * Recording a payment — all of it, or part of it — against a retainer or
 * final bill that is out with the couple.
 *
 * Until 2026-09-30 a payment recorded by hand always settled the whole
 * balance, and a part payment was possible only on a bill StudioCue kept
 * alone. On a QuickBooks or Stripe bill the provider never learned of it, so
 * its balance (the one autopay charges and every sync reports) went on asking
 * for money the couple had paid. Now the payment is recorded here and pushed
 * to the provider (functions/src/booking/invoice-payments.ts):
 *
 * - QuickBooks: a Payment linked to the invoice, after which the balance is
 *   QuickBooks' again.
 * - Stripe: Stripe has no out-of-band *part* payment on an open invoice (its
 *   `paid_out_of_band` settles the whole invoice). A part payment becomes a
 *   credit note for the amount, memo "Paid outside Stripe on <date> by
 *   <method>", which lowers what the couple's link asks for; a payment that
 *   clears the rest is `paid_out_of_band`. Stripe's reports will show the
 *   part payment as a credit, not as cash received — the studio's books say
 *   where the money went.
 *
 * Each payment is appended to `studioPayments`, never edited; its push to the
 * provider is tracked beside it so a re-read balance cannot undo it before
 * the provider has it (invoice-standing.ts, providerReportedInvoice).
 *
 * Pure. Duplicated at functions/src/booking/invoice-payments-core.ts, which
 * cannot import from features/; tests/gap-partial-payments.test.ts fails on a
 * drift.
 */

export type PayableInvoice = {
  status?: unknown;
  kind?: unknown;
  amountCents?: unknown;
  balanceCents?: unknown;
  provider?: unknown;
  providerInvoiceId?: unknown;
  providerState?: unknown;
  completionAuthority?: unknown;
  // Any stored invoice record: the rules read only the fields above.
  [field: string]: unknown;
};

/** Bills a couple pays. */
const PAYABLE_KINDS = new Set(["retainer", "final"]);
/** Raised, but not yet a bill the couple has: nothing to pay against. */
const NOT_YET_BILLED = new Set(["draft", "review_required", "queued"]);
const STUDIO_VOUCHED = new Set(["manual_attested", "imported"]);

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Why no payment can be recorded against this invoice, or null.
 *
 * A QuickBooks or Stripe bill still being created is refused rather than
 * paid: its create job writes the provider's balance when it lands, which
 * would put the payment back on the bill.
 */
export function invoicePaymentRefusal(invoice: PayableInvoice): string | null {
  const status = String(invoice.status ?? "");
  if (!PAYABLE_KINDS.has(String(invoice.kind ?? ""))) return "INVOICE_NOT_PAYABLE";
  if (!isStandingInvoice(status) || invoiceClosedToProviderWork(status)) return "INVOICE_NOT_PAYABLE";
  if (NOT_YET_BILLED.has(status)) return "INVOICE_NOT_BILLED_YET";
  const provider = String(invoice.provider ?? "");
  if ((provider === "quickbooks" || provider === "stripe") && !invoiceAtProvider(invoice))
    return "INVOICE_NOT_BILLED_YET";
  if (!(num(invoice.balanceCents) > 0)) return "INVOICE_NOTHING_OWED";
  return null;
}

/** The provider job that records a payment there, or null when none can. */
export function providerPaymentJobType(invoice: PayableInvoice): string | null {
  if (!invoiceAtProvider(invoice)) return null;
  if (invoice.provider === "quickbooks") return "record_quickbooks_payment";
  if (invoice.provider === "stripe") return "record_stripe_payment";
  return null;
}

export type InvoicePayment = {
  amountCents: number;
  /** yyyy-mm-dd */
  paidAt: string;
};

export type InvoicePaymentPlan =
  | { ok: false; code: string }
  | {
      ok: true;
      /** The payment clears the balance. */
      settles: boolean;
      /** The invoice's current fields after the payment. */
      fields: {
        status: string;
        balanceCents: number;
        completionAuthority?: string;
        paidAt?: string;
      };
      providerJobType: string | null;
    };

/**
 * What a payment makes of the invoice. Pure; the caller appends the payment
 * record beside it and queues the provider job.
 */
export function planInvoicePayment(invoice: PayableInvoice, input: InvoicePayment): InvoicePaymentPlan {
  const refusal = invoicePaymentRefusal(invoice);
  if (refusal) return { ok: false, code: refusal };
  const amount = input.amountCents;
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, code: "PAYMENT_AMOUNT_INVALID" };
  const balance = num(invoice.balanceCents);
  if (amount > balance) return { ok: false, code: "PAYMENT_EXCEEDS_BALANCE" };
  const providerJobType = providerPaymentJobType(invoice);
  if (amount === balance) {
    const authority = String(invoice.completionAuthority ?? "");
    return {
      ok: true,
      settles: true,
      fields: {
        status: "paid",
        balanceCents: 0,
        // A person's word, as when a whole retainer or balance is recorded:
        // the booking gate and the provider re-read both read it that way.
        completionAuthority: STUDIO_VOUCHED.has(authority) ? authority : "manual_attested",
        paidAt: `${input.paidAt}T00:00:00.000Z`,
      },
      providerJobType,
    };
  }
  // No completion authority, and no paidAt: a part payment is not "paid",
  // and the booking gate reads a studio-vouched authority as exactly that.
  return {
    ok: true,
    settles: false,
    fields: { status: "partially_paid", balanceCents: balance - amount },
    providerJobType,
  };
}

/** Parses "1,250.50" or "$400" into cents; null when it isn't an amount. */
export function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
