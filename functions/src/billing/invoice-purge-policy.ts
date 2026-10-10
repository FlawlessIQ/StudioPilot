/**
 * The functions copy of features/billing/invoice-purge-policy.ts.
 *
 * functions/ is a separate package with no "@/features" path, so the rules
 * are duplicated here. Everything below the marker must match the features
 * copy exactly; tests/invoice-purge.test.ts fails on a drift.
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

/** Collections the sweep never touches: idempotency, counters, the job, the audit trail (scrubbed, not deleted), and the invoice itself (last). */
export const INVOICE_PURGE_PROTECTED: readonly string[] = [
  "commandExecutions",
  "webhookEvents",
  "invoiceCounters",
  "projects",
  "auditEvents",
  "invoiceReferences",
  "tenants",
  "memberships",
  "users",
];
