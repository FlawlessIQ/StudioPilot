import type { Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { auditEvent, readJobInvoice, stableId, type CorrectionContext } from "./invoice-corrections.js";
import { HELD_INVOICE_JOB_TYPE } from "../operations/quickbooks-held-invoice.js";

/**
 * "Send with tax" / "Send without tax" / "Work the tax out again" — the
 * studio's answer to a bill held in QuickBooks for them to check
 * (bookingCommand `sendHeldInvoice`, owner/admin).
 *
 * QuickBooks is the sales-tax authority for a switched-on studio, so its tax
 * is a figure nobody has seen until the invoice exists there. Every final
 * bill (and a retainer, when the studio asked) is created in QuickBooks
 * unsent and held (`status: review_required`, `sendReview` on the record).
 * Nothing reaches the couple until one of these is pressed.
 *
 * This only decides and queues: the QuickBooks work — a sparse update that
 * takes the tax off, the address re-sent, the read-back and the email — is
 * the provider job (operations/quickbooks-held-invoice.ts). Like the other
 * money corrections it takes its transaction, so tests drive it in memory.
 */

const OWNER_ADMIN = ["studio_owner", "studio_admin"];

export const sendHeldInvoiceInput = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().min(1),
  action: z.enum(["send_with_tax", "send_without_tax", "recalculate"]),
  /**
   * The total the studio was shown for this action: QuickBooks' total with
   * tax, or its pre-tax subtotal without. Checked, never used: what goes is
   * what QuickBooks holds, read again as it goes.
   */
  confirmAmountCents: z.number().int().nonnegative().nullable().default(null),
});

export type SendHeldInvoiceInput = z.infer<typeof sendHeldInvoiceInput>;

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const cents = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

/** The figure the studio confirms for each action. */
export function heldInvoiceConfirmFigure(invoice: Row, action: SendHeldInvoiceInput["action"]): number | null {
  const review = record(invoice.sendReview);
  if (action === "send_with_tax") return cents(invoice.amountCents);
  if (action === "send_without_tax") return cents(review.subtotalCents);
  return null;
}

/**
 * Why this action cannot be taken on this invoice, or null. Pure.
 *
 * In progress is not a refusal here — the caller answers it (the same
 * request again is the same answer; a different one waits its turn).
 */
export function heldInvoiceActionRefusal(invoice: Row, input: Pick<SendHeldInvoiceInput, "action" | "confirmAmountCents">): string | null {
  const review = record(invoice.sendReview);
  if (invoice.status !== "review_required" || !review.state) return "INVOICE_NOT_HELD";
  if (review.state !== "awaiting_studio") return "INVOICE_ACTION_IN_PROGRESS";
  // A retainer carries no tax: it is only ever sent as it stands.
  if (invoice.kind !== "final" && input.action !== "send_with_tax") return "RETAINER_HAS_NO_TAX";
  if (input.action === "send_with_tax" && review.sendWithTaxBlocked === true) return "BILLING_ADDRESS_NEEDED_FOR_TAX";
  const figure = heldInvoiceConfirmFigure(invoice, input.action);
  if (figure !== null && input.confirmAmountCents !== figure) return "HELD_INVOICE_AMOUNT_CHANGED";
  return null;
}

const ACTION_AUDIT: Record<SendHeldInvoiceInput["action"], string> = {
  send_with_tax: "invoice.sent_with_tax",
  send_without_tax: "invoice.sent_without_tax",
  recalculate: "invoice.tax_recalculation_requested",
};

export async function sendHeldInvoiceIn(
  db: Firestore,
  transaction: Transaction,
  context: CorrectionContext,
  input: SendHeldInvoiceInput,
) {
  if (!OWNER_ADMIN.includes(context.role)) throw new Error("INVOICE_SEND_PERMISSION_REQUIRED");
  const invoice = await readJobInvoice(db, transaction, context, input);
  const project = await transaction.get(db.doc(`projects/${input.projectId}`));
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
  const current = (invoice.data() ?? {}) as Row;
  const review = record(current.sendReview);
  const request = record(review.request);
  const jobId = stableId("held_invoice", context.tenantId, invoice.id, context.idempotencyKey);
  // The same request again (a double press, a retried call): the same answer.
  if (request.idempotencyKey === context.idempotencyKey)
    return { invoiceId: invoice.id, action: input.action, state: String(review.state ?? ""), jobId: String(request.jobId ?? jobId) };
  const refusal = heldInvoiceActionRefusal(current, input);
  if (refusal) throw new Error(refusal);
  const state = input.action === "recalculate" ? "recalculating" : "releasing";
  transaction.update(invoice.ref, {
    sendReview: {
      ...review,
      state,
      request: {
        action: input.action,
        jobId,
        idempotencyKey: context.idempotencyKey,
        by: context.actorId,
        at: context.now,
        confirmAmountCents: input.confirmAmountCents,
      },
    },
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  transaction.create(db.doc(`providerJobs/${jobId}`), {
    id: jobId,
    tenantId: context.tenantId,
    projectId: input.projectId,
    type: HELD_INVOICE_JOB_TYPE,
    invoiceId: invoice.id,
    providerInvoiceId: current.providerInvoiceId ?? null,
    action: input.action,
    requestedBy: context.actorId,
    idempotencyKey: `held-${jobId}`,
    status: "queued",
    attempts: 0,
    createdAt: context.now,
    updatedAt: context.now,
  });
  // Who chose, when, and what the bill said when they did.
  const audit = auditEvent(context, {
    scope: "held_invoice",
    projectId: input.projectId,
    action: invoice.get("kind") === "final" ? ACTION_AUDIT[input.action] : "invoice.retainer_released",
    entityId: invoice.id,
    before: {
      status: current.status ?? null,
      amountCents: cents(current.amountCents),
      taxCents: cents(review.taxCents),
      subtotalCents: cents(review.subtotalCents),
      taxLocation: review.taxLocation ?? null,
    },
    after: {
      action: input.action,
      confirmAmountCents: input.confirmAmountCents,
      taxCents: input.action === "send_without_tax" ? 0 : cents(review.taxCents),
      jobId,
    },
  });
  transaction.create(db.doc(`auditEvents/${audit.id}`), audit.body);
  return { invoiceId: invoice.id, action: input.action, state, jobId };
}

export async function sendHeldInvoice(db: Firestore, context: CorrectionContext, input: SendHeldInvoiceInput) {
  return db.runTransaction((transaction) => sendHeldInvoiceIn(db, transaction, context, input));
}
