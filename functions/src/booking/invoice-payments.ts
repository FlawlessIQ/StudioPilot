import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { requeueStudioInvoicePdf } from "../billing/studio-invoice-issue.js";
import { z } from "zod";
import {
  auditEvent,
  readJobInvoice,
  stableId,
  type CorrectionContext,
} from "./invoice-corrections.js";
import { planInvoicePayment, type PayableInvoice } from "./invoice-payments-core.js";
import { providerReportedInvoice } from "./invoice-standing.js";
import { stoppedBillingTask } from "./stopped-billing.js";

/**
 * Recording a payment against a retainer or final bill — the server half.
 *
 * `recordInvoicePayment` on bookingCommand. The rules are pure, in
 * ./invoice-payments-core.ts (features/booking/invoice-payments.ts explains
 * them); this applies them inside one transaction whose reads come first, so
 * tests drive it with an in-memory one.
 *
 * The payment is StudioCue's record the moment it is made: the balance drops
 * here at once, and autopay charges only what is left. The provider learns of
 * it through a provider job (operations/provider-runtime.ts,
 * recordQuickBooksPayment / recordStripePayment). If the provider refuses,
 * the payment stays recorded here and the studio gets a task to record it
 * there by hand (recordProviderPaymentFailed).
 */

const OWNER_ADMIN = ["studio_owner", "studio_admin"];

export const recordInvoicePaymentInput = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().min(1),
  /** What arrived, in cents: up to the invoice's balance. */
  amountCents: z.number().int().positive(),
  paidAt: z.string().date(),
  /** How the money arrived, in the studio's words. */
  method: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(200).nullable().default(null),
  attestation: z.literal(true),
});

type StudioPaymentEntry = Record<string, unknown> & {
  id: string;
  amountCents: number;
  provider?: Record<string, unknown> | null;
};

function studioPayments(invoice: DocumentSnapshot): StudioPaymentEntry[] {
  const value = invoice.get("studioPayments");
  return Array.isArray(value) ? (value as StudioPaymentEntry[]) : [];
}

function providerName(provider: unknown): string {
  return provider === "stripe" ? "Stripe" : provider === "quickbooks" ? "QuickBooks" : "your invoicing app";
}

export async function recordInvoicePaymentIn(
  db: Firestore,
  transaction: Transaction,
  context: CorrectionContext,
  input: z.infer<typeof recordInvoicePaymentInput>,
) {
  if (!OWNER_ADMIN.includes(context.role)) throw new Error("PAYMENT_RECORD_PERMISSION_REQUIRED");
  const invoice = await readJobInvoice(db, transaction, context, input);
  const project = await transaction.get(db.doc(`projects/${input.projectId}`));
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
  const paymentId = stableId("invoice_payment", context.tenantId, context.idempotencyKey);
  const prior = studioPayments(invoice);
  // A retried click: the payment is already on the record, so answer with it
  // rather than refuse (the balance it cleared may now be zero).
  const recorded = prior.find((entry) => entry.id === paymentId);
  if (recorded)
    return {
      invoiceId: invoice.id,
      paymentId,
      status: String(invoice.get("status") ?? ""),
      balanceCents: Number(invoice.get("balanceCents") ?? 0),
      providerSync: String(recorded.provider?.state ?? "not_applicable"),
    };
  const plan = planInvoicePayment((invoice.data() ?? {}) as PayableInvoice, input);
  if (!plan.ok) throw new Error(plan.code);
  const kind = String(invoice.get("kind") ?? "");
  // A retainer this payment clears may be one the job booked without
  // ("book now, retainer later"): later is now, as recordRetainerPayment says.
  const exceptions =
    plan.settles && kind === "retainer"
      ? await transaction.get(
          db
            .collection("bookingExceptions")
            .where("tenantId", "==", context.tenantId)
            .where("projectId", "==", input.projectId)
            .where("type", "==", "retainer")
            .limit(5),
        )
      : null;
  const approvedException = exceptions?.docs.find((document) => document.get("status") === "approved");

  const before = {
    status: invoice.get("status") ?? null,
    balanceCents: Number(invoice.get("balanceCents") ?? 0),
  };
  const jobId = plan.providerJobType ? `payment_${paymentId}` : null;
  const entry = {
    id: paymentId,
    amountCents: input.amountCents,
    paidAt: input.paidAt,
    method: input.method,
    reference: input.reference,
    attestedBy: context.actorId,
    attestedAt: context.now,
    before,
    after: plan.fields,
    provider: jobId
      ? { name: invoice.get("provider") ?? null, state: "queued", jobId, at: context.now }
      : { name: invoice.get("provider") ?? null, state: "not_applicable", jobId: null, at: context.now },
  };
  transaction.update(invoice.ref, {
    ...plan.fields,
    // Appended, never edited: earlier payments are carried over as they were.
    studioPayments: [...prior, entry],
    lastPaymentAt: input.paidAt,
    // Cleared by this payment, a bill gets the same evidence a whole one
    // recorded by hand gets — unless one is already there, which is never
    // rewritten (invoice-corrections.ts appends corrections beside it).
    ...(plan.settles && !invoice.get("completionEvidence")
      ? {
          completionEvidence: {
            kind: "manual_attestation",
            method: input.method,
            reference: input.reference,
            paidAt: input.paidAt,
            amountCents: input.amountCents,
            attestedBy: context.actorId,
            attestedAt: context.now,
            settledStandingInvoice: true,
            priorStatus: before.status,
            providerInvoiceId: invoice.get("providerInvoiceId") ?? null,
            // Earlier part payments made up the rest; each is in studioPayments.
            partPayments: prior.length,
          },
        }
      : {}),
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  // The client's copy of a bill the studio issued shows the payment (own invoicing).
  requeueStudioInvoicePdf(db, transaction, invoice, context.now);
  if (jobId && plan.providerJobType)
    transaction.create(db.doc(`providerJobs/${jobId}`), {
      id: jobId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      type: plan.providerJobType,
      invoiceId: invoice.id,
      providerInvoiceId: invoice.get("providerInvoiceId"),
      paymentId,
      // Stable per payment: a retried job reaches the provider as the same
      // request, so the money is recorded there once.
      idempotencyKey: `payment-${paymentId}`.slice(0, 50),
      status: "queued",
      attempts: 0,
      createdAt: context.now,
      updatedAt: context.now,
    });
  if (approvedException)
    transaction.update(approvedException.ref, {
      retainerSettledAt: context.now,
      retainerInvoiceId: invoice.id,
      updatedAt: context.now,
    });
  const audit = auditEvent(context, {
    scope: "invoice_payment",
    projectId: input.projectId,
    action: plan.settles ? "invoice.payment_attested" : "invoice.part_payment_attested",
    entityId: invoice.id,
    before,
    after: {
      ...plan.fields,
      paymentId,
      amountCents: input.amountCents,
      paidAt: input.paidAt,
      method: input.method,
      reference: input.reference,
      providerSync: entry.provider.state,
    },
  });
  transaction.create(db.doc(`auditEvents/${audit.id}`), audit.body);
  return {
    invoiceId: invoice.id,
    paymentId,
    status: plan.fields.status,
    balanceCents: plan.fields.balanceCents,
    provider: invoice.get("provider") ?? null,
    providerSync: entry.provider.state,
  };
}

export async function recordInvoicePayment(
  db: Firestore,
  context: CorrectionContext,
  input: z.infer<typeof recordInvoicePaymentInput>,
) {
  return db.runTransaction((transaction) => recordInvoicePaymentIn(db, transaction, context, input));
}

/** The payment a provider job is for, or null when it is no longer on the invoice. */
export function studioPaymentFor(invoice: DocumentSnapshot, paymentId: string): StudioPaymentEntry | null {
  return studioPayments(invoice).find((entry) => entry.id === paymentId) ?? null;
}

/**
 * The provider has the payment. Marks it so, and takes the provider's balance
 * — through providerReportedInvoice, so another payment still on its way
 * there is not undone by this one's re-read.
 */
export async function landStudioPaymentAtProvider(
  db: Firestore,
  job: DocumentSnapshot,
  outcome: { providerPaymentId: string | null; result: string; reported: { status: string; balanceCents: number } | null },
) {
  const reference = db.doc(`invoiceReferences/${String(job.get("invoiceId") ?? "")}`);
  const paymentId = String(job.get("paymentId") ?? "");
  await db.runTransaction(async (transaction) => {
    const invoice = await transaction.get(reference);
    if (!invoice.exists) return;
    const now = new Date().toISOString();
    const payments = studioPayments(invoice).map((entry) =>
      entry.id === paymentId
        ? {
            ...entry,
            provider: {
              ...(entry.provider ?? {}),
              state: "completed",
              jobId: job.id,
              providerPaymentId: outcome.providerPaymentId,
              result: outcome.result,
              at: now,
            },
          }
        : entry,
    );
    const decided = outcome.reported
      ? providerReportedInvoice({
          current: {
            status: invoice.get("status"),
            completionAuthority: invoice.get("completionAuthority"),
            balanceCents: invoice.get("balanceCents"),
            studioPayments: payments,
          },
          reported: outcome.reported,
        })
      : null;
    transaction.update(reference, {
      studioPayments: payments,
      ...(decided
        ? {
            status: decided.status,
            balanceCents: decided.balanceCents,
            ...(decided.keptReason ? { providerReportKept: { reason: decided.keptReason, at: now } } : {}),
            lastSyncedAt: now,
          }
        : {}),
      updatedAt: now,
      updatedBy: "provider-worker",
    });
  });
}

/**
 * The provider would not take the payment. It stays recorded here — the money
 * arrived — and the studio is asked to record it there by hand, so the bill
 * the couple can open stops asking for it.
 */
export async function recordProviderPaymentFailed(
  db: Firestore,
  job: DocumentSnapshot,
  failure: { code: string; message: string },
) {
  const invoiceId = String(job.get("invoiceId") ?? "");
  const paymentId = String(job.get("paymentId") ?? "");
  if (!invoiceId || !paymentId) return;
  const reference = db.doc(`invoiceReferences/${invoiceId}`);
  await db.runTransaction(async (transaction) => {
    const invoice = await transaction.get(reference);
    if (!invoice.exists) return;
    const payment = studioPaymentFor(invoice, paymentId);
    if (!payment) return;
    const now = new Date().toISOString();
    const error = { code: failure.code, message: failure.message.slice(0, 300) };
    transaction.update(reference, {
      studioPayments: studioPayments(invoice).map((entry) =>
        entry.id === paymentId
          ? { ...entry, provider: { ...(entry.provider ?? {}), state: "failed", jobId: job.id, error, at: now } }
          : entry,
      ),
      updatedAt: now,
      updatedBy: "provider-worker",
    });
    const task = paymentSyncTask({
      invoice,
      payment,
      tenantId: String(invoice.get("tenantId") ?? ""),
      projectId: String(invoice.get("projectId") ?? ""),
      now,
    });
    transaction.set(db.doc(`tasks/${task.id}`), task, { merge: true });
  });
}

/** "Record this payment in QuickBooks yourself": one per payment. */
export function paymentSyncTask(input: {
  invoice: DocumentSnapshot;
  payment: StudioPaymentEntry;
  tenantId: string;
  projectId: string;
  now: string;
}) {
  const provider = providerName(input.invoice.get("provider"));
  const number = String(input.invoice.get("providerDocNumber") ?? "");
  const kind = input.invoice.get("kind") === "final" ? "final balance" : "retainer";
  const amount = (Number(input.payment.amountCents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: String(input.invoice.get("currency") ?? "") || "USD",
  });
  const how = String(input.payment.method ?? "").trim();
  const when = String(input.payment.paidAt ?? "").trim();
  return {
    ...stoppedBillingTask({
      id: `payment_sync_${input.payment.id}`,
      tenantId: input.tenantId,
      projectId: input.projectId,
      title: `Record this payment in ${provider} yourself`,
      description: `You recorded ${amount}${how ? ` paid by ${how}` : ""}${when ? ` on ${when}` : ""} against the ${kind} invoice${
        number ? ` ${number}` : ""
      }, and ${provider} wouldn't take it automatically. StudioCue already counts it and won't charge it again; record it against the invoice in ${provider} (check it isn't there already) so the bill the couple can open shows the right balance.`,
      now: input.now,
      actor: "provider-worker",
    }),
    source: "payment_sync",
  };
}
