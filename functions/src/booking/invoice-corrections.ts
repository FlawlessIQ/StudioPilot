import { createHash } from "node:crypto";
import { requeueStudioInvoicePdf } from "../billing/studio-invoice-issue.js";
import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { z } from "zod";
import { balanceMayBeAttested } from "./agreed-final-balance.js";
import {
  invoiceAtProvider,
  invoiceVoidRefusal,
  paidOnInvoice,
  planPaymentCorrection,
  type CorrectableInvoice,
} from "./invoice-corrections-core.js";
import { isStandingInvoice } from "./invoice-standing.js";
import { finalBillBasis, quickBooksIsTaxAuthority } from "./final-tax-authority.js";
import { voidInvoiceTask } from "./stopped-billing.js";
import { combinedSnapshot, readJobSnapshots } from "../packages/combined-snapshot.js";

/**
 * Taking back a bill, and correcting a payment — the server half.
 *
 * Three owner/admin commands on bookingCommand (money audit, wave 1,
 * 2026-09-30):
 *
 * - `voidInvoice`: the "void it first" every refusal pointed at. StudioCue
 *   marks its record voided at once and queues the void at QuickBooks or
 *   Stripe; if the provider refuses, the record stays voided and the studio
 *   gets a task to void it there by hand (recordProviderVoidFailed).
 * - `correctPaymentRecord`: a payment a person recorded, corrected by a record
 *   that supersedes it. The attestation it corrects is left as it was.
 * - `approveFinalInvoice`: a final bill parked at `review_required` was a dead
 *   end — nothing could send it. The studio confirms the balance as it stands
 *   now and it goes to the provider.
 *
 * The rules are pure, in ./invoice-corrections-core.ts. Every write here is
 * inside a transaction whose reads come first, so the functions take the
 * transaction and tests drive them with an in-memory one.
 */

const OWNER_ADMIN = ["studio_owner", "studio_admin"];

export function stableId(scope: string, ...parts: string[]): string {
  return `${scope}_${createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32)}`;
}

export type CorrectionContext = {
  tenantId: string;
  role: string;
  actorId: string;
  now: string;
  idempotencyKey: string;
  ipAddress: string | null;
  userAgent: string | null;
};

export const voidInvoiceInput = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export const correctPaymentRecordInput = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().min(1),
  // What actually arrived, in cents. Zero says no payment arrived at all.
  amountCents: z.number().int().min(0),
  paidAt: z.string().date(),
  method: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(200).nullable().default(null),
  reason: z.string().trim().min(3).max(500),
});

export const approveFinalInvoiceInput = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().min(1),
  /**
   * The balance the studio was shown. Not an amount the browser sets: the
   * server works it out again and refuses if the two differ, so what is sent
   * is what the studio confirmed and what the records say.
   */
  confirmAmountCents: z.number().int().positive(),
});

function invoiceFields(invoice: DocumentSnapshot): CorrectableInvoice {
  return (invoice.data() ?? {}) as CorrectableInvoice;
}

export function auditEvent(
  context: CorrectionContext,
  input: { scope: string; projectId: string; action: string; entityId: string; before: unknown; after: unknown },
) {
  const id = stableId(`audit_${input.scope}`, context.tenantId, context.idempotencyKey);
  return {
    id,
    body: {
      id,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: input.action,
      entityType: "invoiceReference",
      entityId: input.entityId,
      timestamp: context.now,
      before: input.before,
      after: input.after,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    },
  };
}

export async function readJobInvoice(
  db: Firestore,
  transaction: Transaction,
  context: CorrectionContext,
  input: { projectId: string; invoiceId: string },
): Promise<DocumentSnapshot> {
  const invoice = await transaction.get(db.doc(`invoiceReferences/${input.invoiceId}`));
  if (
    !invoice.exists ||
    invoice.get("tenantId") !== context.tenantId ||
    invoice.get("projectId") !== input.projectId
  )
    throw new Error("INVOICE_NOT_FOUND");
  return invoice;
}

/** The provider job type that voids an invoice there, or null when none can. */
export function providerVoidJobType(provider: unknown): string | null {
  if (provider === "quickbooks") return "void_quickbooks_invoice";
  if (provider === "stripe") return "void_stripe_invoice";
  return null;
}

/**
 * Void one invoice, inside the caller's transaction (after its reads).
 *
 * `voided` because every reader of the books already treats it as not owed —
 * the gate, the final bill, the overdue sweep, Today, the couple's portal —
 * and because it is what the provider's own webhook writes, so the two agree.
 */
export function writeInvoiceVoid(
  db: Firestore,
  transaction: Transaction,
  input: {
    invoice: DocumentSnapshot;
    reason: string;
    source: "studio" | "retainer_waived";
    actor: string;
    now: string;
  },
): { providerVoid: "queued" | "not_needed"; jobId: string | null } {
  const { invoice, now, actor } = input;
  const jobType = providerVoidJobType(invoice.get("provider"));
  // Only an invoice the provider actually holds. One still being created is
  // skipped by its create job now that it is voided; one that lands anyway is
  // voided there by landProviderInvoice (operations/provider-runtime.ts).
  const queue = Boolean(jobType) && invoiceAtProvider(invoiceFields(invoice));
  const jobId = queue ? `void_${invoice.id}` : null;
  transaction.update(invoice.ref, {
    status: "voided",
    balanceCents: 0,
    voidedAt: now,
    voidedBy: actor,
    voidReason: input.reason,
    voidSource: input.source,
    voidedFrom: {
      status: invoice.get("status") ?? null,
      balanceCents: Number(invoice.get("balanceCents") ?? 0),
    },
    providerVoid: queue ? { state: "queued", jobId, at: now } : { state: "not_needed", at: now },
    updatedAt: now,
    updatedBy: actor,
  });
  // The client's copy of a bill the studio issued says VOID (own invoicing).
  requeueStudioInvoicePdf(invoice.ref.firestore, transaction, invoice, now);
  if (queue && jobId)
    transaction.create(db.doc(`providerJobs/${jobId}`), {
      id: jobId,
      tenantId: invoice.get("tenantId"),
      projectId: invoice.get("projectId"),
      type: jobType,
      invoiceId: invoice.id,
      providerInvoiceId: invoice.get("providerInvoiceId"),
      // Stable per invoice: a retried job reaches the provider as the same
      // request, and an invoice is voided once.
      idempotencyKey: `void-${invoice.id}`,
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  return { providerVoid: queue ? "queued" : "not_needed", jobId };
}

export async function voidInvoiceIn(
  db: Firestore,
  transaction: Transaction,
  context: CorrectionContext,
  input: z.infer<typeof voidInvoiceInput>,
) {
  if (!OWNER_ADMIN.includes(context.role)) throw new Error("INVOICE_VOID_PERMISSION_REQUIRED");
  const invoice = await readJobInvoice(db, transaction, context, input);
  const refusal = invoiceVoidRefusal(invoiceFields(invoice));
  if (refusal) throw new Error(refusal);
  const written = writeInvoiceVoid(db, transaction, {
    invoice,
    reason: input.reason,
    source: "studio",
    actor: context.actorId,
    now: context.now,
  });
  const audit = auditEvent(context, {
    scope: "invoice_void",
    projectId: input.projectId,
    action: "invoice.voided",
    entityId: invoice.id,
    before: { status: invoice.get("status") ?? null, balanceCents: Number(invoice.get("balanceCents") ?? 0) },
    after: { status: "voided", reason: input.reason, providerVoid: written.providerVoid },
  });
  transaction.create(db.doc(`auditEvents/${audit.id}`), audit.body);
  return {
    invoiceId: invoice.id,
    kind: invoice.get("kind") ?? null,
    status: "voided",
    provider: invoice.get("provider") ?? null,
    providerVoid: written.providerVoid,
  };
}

export async function voidInvoice(
  db: Firestore,
  context: CorrectionContext,
  input: z.infer<typeof voidInvoiceInput>,
) {
  return db.runTransaction((transaction) => voidInvoiceIn(db, transaction, context, input));
}

export async function correctPaymentRecordIn(
  db: Firestore,
  transaction: Transaction,
  context: CorrectionContext,
  input: z.infer<typeof correctPaymentRecordInput>,
) {
  if (!OWNER_ADMIN.includes(context.role)) throw new Error("PAYMENT_CORRECTION_PERMISSION_REQUIRED");
  const invoice = await readJobInvoice(db, transaction, context, input);
  const current = invoiceFields(invoice);
  const plan = planPaymentCorrection(current, input);
  if (!plan.ok) throw new Error(plan.code);
  const prior = Array.isArray(current.paymentCorrections)
    ? (current.paymentCorrections as Array<Record<string, unknown>>)
    : [];
  const correctionId = stableId("payment_correction", context.tenantId, context.idempotencyKey);
  const before = {
    status: invoice.get("status") ?? null,
    balanceCents: Number(invoice.get("balanceCents") ?? 0),
    paidCents: paidOnInvoice(current),
    completionAuthority: invoice.get("completionAuthority") ?? null,
  };
  const entry = {
    id: correctionId,
    amountCents: input.amountCents,
    paidAt: input.amountCents > 0 ? input.paidAt : null,
    method: input.method,
    reference: input.reference,
    reason: input.reason,
    // The record this one replaces: the last correction, or the original
    // attestation (completionEvidence), which is never edited.
    supersedes: typeof prior.at(-1)?.id === "string" ? prior.at(-1)!.id : "completionEvidence",
    before,
    after: plan.fields,
    correctedBy: context.actorId,
    correctedAt: context.now,
  };
  transaction.update(invoice.ref, {
    ...plan.fields,
    // Appended, never edited: earlier entries are carried over as they were.
    paymentCorrections: [...prior, entry],
    currentPayment: {
      source: "correction",
      correctionId,
      amountCents: input.amountCents,
      paidAt: entry.paidAt,
      method: input.method,
      reference: input.reference,
    },
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  requeueStudioInvoicePdf(invoice.ref.firestore, transaction, invoice, context.now);
  // Withdrawn from an invoice QuickBooks holds: its balance is QuickBooks'
  // again, which may have taken a payment of its own meanwhile. Re-read it.
  if (plan.reopenedAtProvider && invoice.get("provider") === "quickbooks") {
    const jobId = `reconcile_${correctionId}`;
    transaction.create(db.doc(`providerJobs/${jobId}`), {
      id: jobId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      type: "reconcile_quickbooks_invoice",
      invoiceId: invoice.id,
      providerInvoiceId: invoice.get("providerInvoiceId"),
      idempotencyKey: `reconcile-${correctionId}`,
      status: "queued",
      attempts: 0,
      createdAt: context.now,
      updatedAt: context.now,
    });
  }
  const audit = auditEvent(context, {
    scope: "payment_correction",
    projectId: input.projectId,
    action: "invoice.payment_corrected",
    entityId: invoice.id,
    before,
    after: { ...plan.fields, correctionId, amountCents: input.amountCents, reason: input.reason },
  });
  transaction.create(db.doc(`auditEvents/${audit.id}`), audit.body);
  return {
    invoiceId: invoice.id,
    correctionId,
    status: plan.fields.status,
    paidCents: plan.paidCents,
    balanceCents: plan.fields.balanceCents,
  };
}

export async function correctPaymentRecord(
  db: Firestore,
  context: CorrectionContext,
  input: z.infer<typeof correctPaymentRecordInput>,
) {
  return db.runTransaction((transaction) => correctPaymentRecordIn(db, transaction, context, input));
}

/**
 * The final balance as it stands now: what the couple agreed, less every
 * payment on a bill still standing other than this one.
 *
 * The same arithmetic final-invoice.ts raises by, and the same the screens
 * show (features/booking/final-balance-due.ts), so the figure the studio
 * confirms is the figure that goes.
 */
export async function approveFinalInvoiceIn(
  db: Firestore,
  transaction: Transaction,
  context: CorrectionContext,
  input: z.infer<typeof approveFinalInvoiceInput>,
) {
  if (!OWNER_ADMIN.includes(context.role)) throw new Error("BALANCE_ATTESTATION_PERMISSION_REQUIRED");
  const invoice = await readJobInvoice(db, transaction, context, input);
  if (invoice.get("kind") !== "final" || invoice.get("status") !== "review_required")
    throw new Error("FINAL_INVOICE_NOT_IN_REVIEW");
  // Already made in QuickBooks and waiting on the tax check: that bill is
  // sent with "Send with tax" / "Send without tax" (held-invoice-send.ts).
  if (invoice.get("sendReview")) throw new Error("INVOICE_HELD_FOR_TAX_CHECK");
  const project = await transaction.get(db.doc(`projects/${input.projectId}`));
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
  if (!balanceMayBeAttested(String(project.get("state")))) throw new Error("BALANCE_NOT_READY");
  const snapshotId = String(project.get("packageSnapshotId") ?? "");
  const [invoices, proposals, packageSnapshot] = await Promise.all([
    transaction.get(
      db
        .collection("invoiceReferences")
        .where("tenantId", "==", context.tenantId)
        .where("projectId", "==", input.projectId)
        .limit(40),
    ),
    transaction.get(
      db
        .collection("proposals")
        .where("tenantId", "==", context.tenantId)
        .where("projectId", "==", input.projectId)
        .where("status", "==", "accepted")
        .limit(5),
    ),
    snapshotId
      ? readJobSnapshots(db, project.data(), context.tenantId, (reference) => transaction.get(reference)).then(
          (snapshots) => (snapshots.length ? combinedSnapshot(snapshots) : null),
        )
      : Promise.resolve(null),
  ]);
  const others = invoices.docs.filter(
    (candidate) => candidate.id !== invoice.id && isStandingInvoice(candidate.get("status")),
  );
  // One bill for one balance.
  if (others.some((candidate) => candidate.get("kind") === "final" && Number(candidate.get("balanceCents") ?? 0) > 0))
    throw new Error("FINAL_INVOICE_ALREADY_OUT");
  const accepted = [...proposals.docs].sort(
    (a, b) => Number(b.get("version") ?? 0) - Number(a.get("version") ?? 0),
  )[0];
  const pricing = (accepted?.get("pricingSnapshot") ?? null) as Record<string, unknown> | null;
  const agreed = Number(pricing?.totalCents);
  const fromProposal = Boolean(accepted && Number.isSafeInteger(agreed) && agreed > 0);
  const provider = invoice.get("provider") === "stripe" ? "stripe" : "quickbooks";
  // Pre-tax when QuickBooks is the sales-tax authority — final-tax-authority.ts.
  const quickBooksTax = await quickBooksIsTaxAuthority(db, transaction, context.tenantId, provider);
  const basis = finalBillBasis({
    totalCents: fromProposal ? agreed : Number(packageSnapshot?.get("totalCents") ?? 0),
    agreedTaxCents: fromProposal ? Number(pricing?.taxCents ?? 0) : Number(packageSnapshot?.get("taxCents") ?? 0),
    quickBooksTax,
  });
  const totalCents = basis.billedTotalCents;
  const taxCents = basis.taxCents;
  const source = fromProposal ? `proposals/${accepted!.id}` : `packageSnapshots/${snapshotId}`;
  const paidCents = others.reduce(
    (sum, candidate) => sum + paidOnInvoice((candidate.data() ?? {}) as CorrectableInvoice),
    0,
  );
  const amountCents = totalCents - paidCents;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error("NOTHING_OWED");
  if (amountCents !== input.confirmAmountCents) throw new Error("FINAL_AMOUNT_CHANGED");
  const calculation = (invoice.get("calculation") ?? {}) as Record<string, unknown>;
  transaction.update(invoice.ref, {
    status: "draft",
    providerState: "queued",
    providerInvoiceId: `pending_${invoice.id}`,
    amountCents,
    balanceCents: amountCents,
    calculation: {
      ...calculation,
      lines: [
        { label: "Approved package and add-ons", amountCents: totalCents - taxCents, source },
        quickBooksTax
          ? { label: "Sales tax — calculated by QuickBooks when the invoice is made", amountCents: 0, source: "quickbooks" }
          : { label: "Approved tax", amountCents: taxCents, source },
        { label: "Payments received", amountCents: -paidCents, source: "invoiceReferences" },
      ],
      packageTotalCents: totalCents,
      taxCents,
      ...(quickBooksTax ? { taxAuthority: "quickbooks", agreedTaxExcludedCents: basis.agreedTaxExcludedCents } : {}),
      expectedBalanceCents: amountCents,
      // What was flagged stays on the record, with who looked and said go.
      reviewedDiscrepancies: Array.isArray(calculation.discrepancies) ? calculation.discrepancies : [],
      discrepancies: [],
      approvedBy: context.actorId,
      approvedAt: context.now,
      recalculatedAt: context.now,
    },
    updatedAt: context.now,
    updatedBy: context.actorId,
  });
  transaction.create(db.doc(`providerJobs/invoice_${invoice.id}`), {
    id: `invoice_${invoice.id}`,
    tenantId: context.tenantId,
    projectId: input.projectId,
    type: provider === "stripe" ? "create_stripe_invoice" : "create_quickbooks_invoice",
    invoiceId: invoice.id,
    idempotencyKey: `final-invoice-${invoice.id}`,
    status: "queued",
    attempts: 0,
    createdAt: context.now,
    updatedAt: context.now,
  });
  const audit = auditEvent(context, {
    scope: "final_invoice_approved",
    projectId: input.projectId,
    action: "final_invoice.approved",
    entityId: invoice.id,
    before: { status: "review_required", amountCents: Number(invoice.get("amountCents") ?? 0) },
    after: { status: "draft", amountCents, paidCents, totalCents },
  });
  transaction.create(db.doc(`auditEvents/${audit.id}`), audit.body);
  return { invoiceId: invoice.id, amountCents, provider };
}

export async function approveFinalInvoice(
  db: Firestore,
  context: CorrectionContext,
  input: z.infer<typeof approveFinalInvoiceInput>,
) {
  return db.runTransaction((transaction) => approveFinalInvoiceIn(db, transaction, context, input));
}

/**
 * The provider would not void it. StudioCue's record stays voided — the
 * studio decided — and the studio is told to void it where it was raised, so
 * the couple is not left holding a payable bill.
 */
export async function recordProviderVoidFailed(
  db: Firestore,
  job: DocumentSnapshot,
  failure: { code: string; message: string },
) {
  const invoiceId = String(job.get("invoiceId") ?? "");
  if (!invoiceId) return;
  const reference = db.doc(`invoiceReferences/${invoiceId}`);
  await db.runTransaction(async (transaction) => {
    const invoice = await transaction.get(reference);
    if (!invoice.exists) return;
    const now = new Date().toISOString();
    transaction.update(reference, {
      providerVoid: { state: "failed", jobId: job.id, error: { code: failure.code, message: failure.message.slice(0, 300) }, at: now },
      updatedAt: now,
      updatedBy: "provider-worker",
    });
    const task = voidInvoiceTask({
      invoice,
      tenantId: String(invoice.get("tenantId") ?? ""),
      projectId: String(invoice.get("projectId") ?? ""),
      why: "You voided this invoice in StudioCue, and the provider wouldn't void it automatically.",
      now,
      actor: "provider-worker",
    });
    transaction.set(db.doc(`tasks/${task.id}`), task, { merge: true });
  });
}
