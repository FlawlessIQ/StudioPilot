import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { isStandingInvoice } from "./invoice-standing.js";

/**
 * What calling a job off does to its money.
 *
 * Found in the money audit of 2026-09-30: cancelling a job, or closing an
 * inquiry as lost, changed the project's state and nothing else. The booking
 * plan stayed `active`, so a retainer the couple paid afterwards drove the
 * orchestrator into INVALID_BOOKING_STATE inside a trigger with no retry. The
 * open retainer and final bills stayed owed, so the overdue sweep, the daily
 * digest and autopay all went on treating a called-off wedding as money due —
 * while the job page said "Nothing is outstanding".
 *
 * StudioCue cannot void at the provider (there is no void implementation), so
 * it does what a booking change already does for a replaced invoice
 * (amendment-apply.ts): stops counting the bill itself and gives the studio a
 * task to void it where it was raised. Money already received is not
 * StudioCue's to decide about — refunding or keeping a retainer is the
 * studio's call under its own agreement — so that becomes a task too.
 */

export type BillingStop = "cancelled" | "lost";

/**
 * The wedding is not happening: cancelled, closed as lost, or filed away
 * before it was ever booked. Nothing about it can be booked, whatever money
 * arrives. (An archived job that *was* booked went ahead and closed out.)
 */
export function jobCalledOff(project: unknown): boolean {
  const fields = (project ?? {}) as { state?: unknown; bookingCompletedAt?: unknown };
  const state = String(fields.state ?? "");
  if (state === "CANCELLED" || state === "LOST") return true;
  return state === "ARCHIVED" && !fields.bookingCompletedAt;
}

type InvoiceLike = {
  id: string;
  status: unknown;
  kind?: unknown;
  amountCents?: unknown;
  balanceCents?: unknown;
  providerState?: unknown;
  providerInvoiceId?: unknown;
};

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Paid so far on one invoice. */
function paidOf(invoice: InvoiceLike): number {
  const amount = num(invoice.amountCents);
  const balance = invoice.balanceCents == null ? amount : num(invoice.balanceCents);
  return Math.max(0, amount - balance);
}

/** Raised at the provider, so a person has to void it there. */
export function existsAtProvider(invoice: InvoiceLike): boolean {
  const providerInvoiceId = typeof invoice.providerInvoiceId === "string" ? invoice.providerInvoiceId : "";
  return (
    invoice.providerState === "completed" &&
    providerInvoiceId.length > 0 &&
    !providerInvoiceId.startsWith("pending_")
  );
}

/**
 * Pure. Which bills stop being owed, which of those need voiding at the
 * provider, and how much the couple has already paid.
 */
export function planStoppedBilling(invoices: readonly InvoiceLike[]): {
  close: string[];
  voidAtProvider: string[];
  paidCents: number;
} {
  const standing = invoices.filter((invoice) => isStandingInvoice(invoice.status));
  const open = standing.filter(
    (invoice) => String(invoice.status) !== "paid" && num(invoice.balanceCents) > 0,
  );
  return {
    close: open.map((invoice) => invoice.id),
    voidAtProvider: open.filter(existsAtProvider).map((invoice) => invoice.id),
    paidCents: standing.reduce((sum, invoice) => sum + paidOf(invoice), 0),
  };
}

function providerName(provider: unknown): string {
  return provider === "quickbooks" ? "QuickBooks" : provider === "stripe" ? "Stripe" : "your invoicing app";
}

/** Shaped like features/tasks/schema.ts, as amendment-apply.ts writes them. */
export function stoppedBillingTask(input: {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  description: string;
  now: string;
  actor: string;
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
    source: "job_stopped",
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: input.actor,
    updatedBy: input.actor,
    archivedAt: null,
  };
}

/** The void task for one invoice StudioCue no longer counts. */
export function voidInvoiceTask(input: {
  invoice: DocumentSnapshot;
  tenantId: string;
  projectId: string;
  why: string;
  now: string;
  actor: string;
}) {
  const number = String(input.invoice.get("providerDocNumber") ?? "");
  const provider = providerName(input.invoice.get("provider"));
  const kind = input.invoice.get("kind") === "final" ? "balance" : "retainer";
  return stoppedBillingTask({
    id: `invoice_void_${input.invoice.id}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    title: `Void ${number ? `invoice ${number}` : `the ${kind} invoice`} in ${provider}`,
    description: `${input.why} StudioCue no longer counts this ${kind} invoice and won't chase or charge it; void it in ${provider} so the couple isn't asked to pay it.`,
    now: input.now,
    actor: input.actor,
  });
}

/** The refund-or-keep task. One per job: its id is the job's. */
export function refundOrKeepTask(input: {
  tenantId: string;
  projectId: string;
  paidCents: number;
  currency: string;
  now: string;
  actor: string;
}) {
  const amount = (input.paidCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: input.currency || "USD",
  });
  return stoppedBillingTask({
    id: `refund_or_keep_${input.projectId}`,
    tenantId: input.tenantId,
    projectId: input.projectId,
    title: "Refund or keep the retainer paid after cancelling",
    description: `The couple has paid ${amount} on a job that is no longer going ahead. Decide under your agreement whether to refund it or keep it, and do that where it was paid. StudioCue doesn't move money back on its own.`,
    now: input.now,
    actor: input.actor,
  });
}

export type StoppedBillingReads = {
  invoices: DocumentSnapshot[];
  plan: DocumentSnapshot;
  refundTask: DocumentSnapshot;
};

/** Every read the write below needs, done first as a transaction requires. */
export async function readStoppedBilling(
  db: Firestore,
  transaction: Transaction,
  tenantId: string,
  projectId: string,
): Promise<StoppedBillingReads> {
  const [invoices, plan, refundTask] = await Promise.all([
    transaction.get(
      db
        .collection("invoiceReferences")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", projectId)
        .limit(40),
    ),
    transaction.get(db.doc(`bookingOrchestrations/${projectId}`)),
    transaction.get(db.doc(`tasks/refund_or_keep_${projectId}`)),
  ]);
  return { invoices: invoices.docs, plan, refundTask };
}

/** Close the job's billing in the same transaction that stops the job. */
export function writeStoppedBilling(
  db: Firestore,
  transaction: Transaction,
  input: {
    tenantId: string;
    projectId: string;
    stop: BillingStop;
    reads: StoppedBillingReads;
    now: string;
    actor: string;
  },
): { closedInvoiceIds: string[]; voidTaskIds: string[]; refundTask: boolean } {
  const { reads, tenantId, projectId, now, actor } = input;
  const plan = planStoppedBilling(
    reads.invoices.map((invoice) => ({
      id: invoice.id,
      status: invoice.get("status"),
      kind: invoice.get("kind"),
      amountCents: invoice.get("amountCents"),
      balanceCents: invoice.get("balanceCents"),
      providerState: invoice.get("providerState"),
      providerInvoiceId: invoice.get("providerInvoiceId"),
    })),
  );
  const why =
    input.stop === "cancelled"
      ? "The job was cancelled."
      : "The inquiry was closed as lost.";
  const voidTaskIds: string[] = [];
  for (const invoice of reads.invoices) {
    if (!plan.close.includes(invoice.id)) continue;
    // `superseded` because every reader of the books already treats it as
    // "not owed" — the gate, the final bill, the overdue sweep, Today, the
    // couple's portal. A new status would have to be taught to all of them.
    transaction.update(invoice.ref, {
      status: "superseded",
      supersededAt: now,
      supersededBy: input.stop === "cancelled" ? "project_cancelled" : "project_lost",
      updatedAt: now,
      updatedBy: actor,
    });
    if (!plan.voidAtProvider.includes(invoice.id)) continue;
    const task = voidInvoiceTask({ invoice, tenantId, projectId, why, now, actor });
    transaction.set(db.doc(`tasks/${task.id}`), task);
    voidTaskIds.push(task.id);
  }
  if (reads.plan.exists && ["active", "needs_attention"].includes(String(reads.plan.get("status")))) {
    transaction.update(reads.plan.ref, {
      status: "cancelled",
      currentStep: "cancelled",
      cancelledAt: now,
      cancelledReason: input.stop === "cancelled" ? "project_cancelled" : "project_lost",
      updatedAt: now,
    });
  }
  const refund = plan.paidCents > 0 && !reads.refundTask.exists;
  if (refund) {
    const currency = String(
      reads.invoices.find((invoice) => invoice.get("currency"))?.get("currency") ?? "USD",
    );
    const task = refundOrKeepTask({ tenantId, projectId, paidCents: plan.paidCents, currency, now, actor });
    transaction.set(db.doc(`tasks/${task.id}`), task);
  }
  return { closedInvoiceIds: plan.close, voidTaskIds, refundTask: refund };
}
