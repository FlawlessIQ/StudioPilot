/**
 * Money that moves back in QuickBooks: the pure half.
 *
 * Until 2026-10-01 the QuickBooks webhook acted on Invoice events only. A
 * Payment, RefundReceipt or CreditMemo event was stored as "ignored /
 * UNSUPPORTED_ENTITY", so:
 *
 *  - a payment deleted or voided in QuickBooks reopened the invoice there
 *    (its balance comes back) but StudioCue went on showing it paid, unless
 *    QuickBooks happened to send an Invoice event as well — and even then the
 *    studio was not told;
 *  - a refund (RefundReceipt) left no trace in StudioCue at all.
 *
 * Now a payment or credit memo event re-reads the invoices it touched (the
 * invoice reconcile is the one place a balance is taken from QuickBooks), an
 * invoice QuickBooks no longer shows as paid reopens with a task on Today,
 * and a refund raises a task naming the amount. A refund does not reopen an
 * invoice: in QuickBooks the invoice stays paid and the refund is a separate
 * transaction, so StudioCue's bill matches QuickBooks' and the studio decides
 * what happens next. The I/O is quickbooks-money-events.ts; this file is
 * pinned by tests/billing-settings.test.ts.
 */

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The QuickBooks entities (webhook names, lower case) that move money on an invoice. */
export const QUICKBOOKS_MONEY_ENTITIES = new Set(["payment", "refundreceipt", "creditmemo"]);

export const RECONCILE_MONEY_EVENT_JOB = "reconcile_quickbooks_money_event";

/** Deleted entities cannot be read back; the worker then re-reads every paid invoice. */
export function quickBooksEntityGone(operation: string): boolean {
  return ["delete", "deleted"].includes(operation.toLowerCase());
}

/** The QuickBooks invoice ids a payment (or credit memo) is applied to. */
export function invoiceIdsLinkedTo(entity: unknown): string[] {
  const ids = new Set<string>();
  const lines = record(entity).Line;
  if (!Array.isArray(lines)) return [];
  for (const line of lines) {
    const linked = record(line).LinkedTxn;
    if (!Array.isArray(linked)) continue;
    for (const transaction of linked) {
      const entry = record(transaction);
      if (text(entry.TxnType) === "Invoice" && text(entry.TxnId)) ids.add(text(entry.TxnId));
    }
  }
  return [...ids];
}

const PAID_LIKE = new Set(["paid"]);
const OPEN_AGAIN = new Set(["sent", "partially_paid"]);

/**
 * QuickBooks has taken money back off an invoice StudioCue counted as paid:
 * it was paid, and now QuickBooks shows more owing.
 */
export function reopenedByProvider(input: {
  before: { status: unknown; balanceCents: unknown };
  after: { status: string; balanceCents: number };
}): boolean {
  return (
    PAID_LIKE.has(String(input.before.status)) &&
    OPEN_AGAIN.has(input.after.status) &&
    input.after.balanceCents > Math.max(0, Number(input.before.balanceCents ?? 0) || 0)
  );
}

const money = (amountCents: number, currency: string) =>
  (amountCents / 100).toLocaleString("en-US", { style: "currency", currency: currency || "USD" });

function studioTask(input: {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  source: string;
  now: string;
}) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workflowRunId: null,
    checkpointId: null,
    title: input.title,
    description: input.description,
    status: "not_started",
    priority: "high",
    assignedUserId: null,
    assignedRole: "studio_owner",
    dueDate: input.now.slice(0, 10),
    blocking: false,
    completedAt: null,
    completedBy: null,
    source: input.source,
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: "quickbooks-reconciliation",
    updatedBy: "quickbooks-reconciliation",
    archivedAt: null,
  };
}

/** "QuickBooks no longer shows the retainer paid": one per invoice. */
export function reopenedInvoiceTask(input: {
  invoiceId: string;
  tenantId: string;
  projectId: string;
  kind: unknown;
  docNumber: unknown;
  balanceCents: number;
  currency: unknown;
  now: string;
}) {
  const kind = input.kind === "final" ? "final balance" : "retainer";
  const number = text(input.docNumber);
  return studioTask({
    id: `invoice_reopened_${input.invoiceId}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    title: `QuickBooks no longer shows the ${kind} paid`,
    description: `A payment on the ${kind} invoice${number ? ` ${number}` : ""} was removed or voided in QuickBooks, so ${money(
      input.balanceCents,
      String(input.currency ?? ""),
    )} is owing again. StudioCue has reopened the invoice to match. If that was a mistake, record the payment again in QuickBooks; if the money really went back, decide with the couple what happens next.`,
    source: "quickbooks_reopened",
    now: input.now,
  });
}

/** "A refund was recorded in QuickBooks": one per refund receipt. */
export function refundRecordedTask(input: {
  refundId: string;
  tenantId: string;
  projectId: string;
  amountCents: number;
  currency: unknown;
  docNumber: unknown;
  customerName: unknown;
  now: string;
}) {
  const number = text(input.docNumber);
  const who = text(input.customerName);
  return studioTask({
    id: `quickbooks_refund_${input.refundId}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    title: `Refund of ${money(input.amountCents, String(input.currency ?? ""))} recorded in QuickBooks`,
    description: `QuickBooks recorded a refund${number ? ` (no. ${number})` : ""}${who ? ` to ${who}` : ""}. A refund doesn't reopen an invoice, so StudioCue still shows what was paid as paid. If the job is off, cancel it in StudioCue; if the couple still owes this money, raise a new invoice.`,
    source: "quickbooks_refund",
    now: input.now,
  });
}

/** What a RefundReceipt says, for the task. */
export function refundSummary(entity: unknown): {
  customerId: string;
  customerName: string;
  amountCents: number;
  docNumber: string;
  currency: string;
} {
  const refund = record(entity);
  const customer = record(refund.CustomerRef);
  const total = Number(refund.TotalAmt);
  return {
    customerId: text(customer.value),
    customerName: text(customer.name),
    amountCents: Number.isFinite(total) ? Math.max(0, Math.round(total * 100)) : 0,
    docNumber: text(refund.DocNumber),
    currency: text(record(refund.CurrencyRef).value) || "USD",
  };
}
