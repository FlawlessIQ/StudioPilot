/**
 * Deleting invoice records (own invoicing, Phase 5;
 * docs/own-invoicing-plan-2026-10-09.md). Conor, 2026-10-09: a studio may
 * delete its invoice records during or after a job.
 *
 * This is StudioCue's third hard delete, beside tenant deletion and the job
 * purge (see the memory note hard-delete-is-one-exception), and it keeps the
 * same three rules: records are found by query, every one is tenant-checked,
 * and the invoice itself — the record that authorises a retry — goes last
 * (functions/src/billing/invoice-purge.ts). Unlike the job purge, only the
 * collections in INVOICE_PURGE_OWNED are deleted from: an invoice is named by
 * records that outlive it (a booking plan, an autopay charge), and discovery
 * only reports those.
 *
 * What it must never do is make a job go backwards. So:
 * - A paid invoice leaves a money-free "settled" note on the job
 *   (`projects.billing.settled.<kind>`): when, by whom, and nothing about
 *   amounts. The booking check, readiness and closeout read it as paid.
 * - A paid deposit can only go once nothing more is worked out from it — the
 *   job's final is paid (or deleted with it), or the job has no final.
 *   Before then the final balance is "the price less what was paid", and
 *   deleting the payment would bill the whole price again.
 * - Part paid: settle it or void it first; half a record is the worst kind.
 * - Never while a provider or autopay is mid-flight on it.
 * - Unpaid or closed bills can go any time; the requirement they met reopens.
 *
 * functions/src/billing/invoice-purge-policy.ts is a copy of everything below
 * the marker; tests/invoice-purge.test.ts fails on a drift.
 */

// --- shared with functions/src/billing/invoice-purge-policy.ts ---
export type SettledKind = "retainer" | "final";

export type InvoiceDeleteRefusal = "INVOICE_IN_FLIGHT" | "INVOICE_PARTLY_PAID" | "INVOICE_STILL_NEEDED";

export type InvoiceDeletePlan =
  | { allowed: true; settles: SettledKind | null; paidInFull: boolean }
  | { allowed: false; reason: InvoiceDeleteRefusal };

type Row = Readonly<Record<string, unknown>>;

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const CLOSED = new Set(["voided", "void", "superseded", "failed", "cancelled", "refunded"]);

const num = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function invoiceIsPaid(invoice: Row): boolean {
  return invoice.status === "paid" && num(invoice.balanceCents) <= 0;
}

function paidOn(invoice: Row): number {
  return Math.max(0, num(invoice.amountCents) - num(invoice.balanceCents));
}

/** `projects.billing.settled.<kind>`: a paid invoice of that kind was deleted. */
export function invoiceSettledByDeletion(project: unknown, kind: SettledKind): boolean {
  const settled = record(record(record(project).billing).settled);
  return Object.keys(record(settled[kind])).length > 0;
}

/** A settled note stands in for the deleted paid invoice's status. */
export function settledInvoiceStatus(project: unknown, kind: SettledKind): "paid" | null {
  return invoiceSettledByDeletion(project, kind) ? "paid" : null;
}

/** A deleted paid-in-full payment settles the whole price, final included. */
export function paidInFullSettledByDeletion(project: unknown): boolean {
  const retainer = record(record(record(record(project).billing).settled).retainer);
  return retainer.paidInFull === true;
}

/**
 * Some of this job's invoice records were deleted. Nothing works a balance
 * out from the invoices left any more: what was paid is no longer known.
 */
export function invoiceRecordsDeleted(project: unknown): boolean {
  return typeof record(record(project).billing).recordsDeletedAt === "string";
}

/**
 * Whether this invoice may be deleted, and what note it leaves.
 *
 * `others`: the job's other invoices that will remain. `jobHasFinalBalance`:
 * the job's kind bills a final (job-kinds.ts hasFinalBalance).
 * `inFlight`: a provider job or an autopay charge is working on it.
 */
export function invoiceDeletePlan(input: {
  invoice: Row;
  others: ReadonlyArray<Row>;
  project: unknown;
  jobHasFinalBalance: boolean;
  inFlight: boolean;
}): InvoiceDeletePlan {
  const { invoice } = input;
  if (input.inFlight) return { allowed: false, reason: "INVOICE_IN_FLIGHT" };
  const status = String(invoice.status ?? "");
  if (CLOSED.has(status)) return { allowed: true, settles: null, paidInFull: false };
  const paid = invoiceIsPaid(invoice);
  if (!paid && paidOn(invoice) > 0) return { allowed: false, reason: "INVOICE_PARTLY_PAID" };
  if (!paid) return { allowed: true, settles: null, paidInFull: false };
  // A paid installment of a payment plan comes off the final balance
  // (features/billing/payment-plan.ts), like the deposit: it goes once the
  // final is paid, and leaves no note — readiness and closeout read the final.
  if (invoice.kind === "installment") {
    const balancePaid =
      input.others.some((other) => other.kind === "final" && !CLOSED.has(String(other.status ?? "")) && invoiceIsPaid(other)) ||
      invoiceSettledByDeletion(input.project, "final");
    return balancePaid ? { allowed: true, settles: null, paidInFull: false } : { allowed: false, reason: "INVOICE_STILL_NEEDED" };
  }
  const kind: SettledKind = invoice.kind === "final" ? "final" : "retainer";
  const paidInFull = invoice.paidInFull === true;
  if (kind === "final" || paidInFull || !input.jobHasFinalBalance) return { allowed: true, settles: kind, paidInFull };
  // A paid deposit, and the job bills a final: the final must already be paid.
  const finalPaid =
    input.others.some((other) => other.kind === "final" && !CLOSED.has(String(other.status ?? "")) && invoiceIsPaid(other)) ||
    invoiceSettledByDeletion(input.project, "final");
  return finalPaid ? { allowed: true, settles: kind, paidInFull } : { allowed: false, reason: "INVOICE_STILL_NEEDED" };
}

/**
 * Remove the money from an audit event's before/after, keeping the rest.
 * Studios asked for their invoice records deleted; an audit trail that
 * still held every amount would make that untrue. Keys are matched by name.
 */
const MONEY_KEY = /cents|amount|balance|total|tax|price|paid|method|reference/i;

export function scrubMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubMoney);
  if (typeof value !== "object" || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (MONEY_KEY.test(key)) continue;
    out[key] = scrubMoney(inner);
  }
  return out;
}

/**
 * The collections whose records belong to an invoice and go with it. An
 * allow list, not a deny list: the sweep used to delete whatever named the
 * invoice anywhere except a few protected collections, and that deleted a
 * job's booking plan — when the replacement deposit was paid nothing booked
 * the job (GR, Michelle & Kyle, 2026-10-22) — and would have deleted autopay
 * charges, the proof a card was charged. A record anywhere else that names
 * the invoice is kept and reported (invoice-purge.ts), so a new reference is
 * noticed, never silently deleted.
 *
 * Each is here because nothing but the invoice reads it:
 * - `emailJobs`: the invoice's own emails (sending it, its receipts). They
 *   carry its amounts and number.
 * - `pdfJobs`: renders of its PDF, `pdfJobs/invoice_<id>_r<n>`.
 * - `providerJobs`: work done on it at QuickBooks or Stripe — create, sync,
 *   void, reconcile, record a payment, charge a saved card. A job still
 *   running refuses the delete (INVOICE_IN_FLIGHT) before anything goes.
 * - `documents`: only its PDF's file record, `documents/studio_invoice_<id>`
 *   (invoiceOwnsRecord). Any other document is a file the studio keeps.
 */
export const INVOICE_PURGE_OWNED: readonly string[] = ["emailJobs", "pdfJobs", "providerJobs", "documents"];

/**
 * Collections known to name an invoice that the sweep keeps, so they are
 * not reported as new:
 * - `auditEvents`: the audit trail stays, scrubbed of its money.
 * - `bookingOrchestrations`: the job's booking plan, unlinked, never deleted.
 * - `invoiceReferences`: the invoice itself, deleted last by id.
 * - `autopayCharges`: proof a card was charged; money taken is never forgotten.
 * - `commandExecutions`, `webhookEvents`: idempotency, so a retry still finds
 *   what it did.
 */
export const INVOICE_PURGE_KEPT: readonly string[] = [
  "auditEvents",
  "bookingOrchestrations",
  "invoiceReferences",
  "autopayCharges",
  "commandExecutions",
  "webhookEvents",
];

/** Whether this record, which names the invoice, belongs to it and goes with it. */
export function invoiceOwnsRecord(collection: string, id: string, invoiceId: string): boolean {
  if (!INVOICE_PURGE_OWNED.includes(collection)) return false;
  // Its PDF's file record (billing/studio-invoice-pdf.ts invoicePdfDocumentId), nothing else.
  if (collection === "documents") return id === `studio_invoice_${invoiceId}`;
  return true;
}
