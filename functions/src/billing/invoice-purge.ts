import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import { hasFinalBalance, projectProfile } from "../job-kinds/job-kinds.js";
import { INVOICE_PURGE_PROTECTED, invoiceDeletePlan, scrubMoney, type SettledKind } from "./invoice-purge-policy.js";
import { PAYMENT_REMINDER } from "./payment-reminders.js";

/**
 * Deleting invoice records, for one bill or a whole job (own invoicing,
 * Phase 5). The rules are in ./invoice-purge-policy.ts; this is the sweep.
 *
 * Order matters, the same way it does for the job purge
 * (projects/purge-command.ts):
 * 1. The job's "settled" note is written first, so a sweep that dies part
 *    way never leaves a booked or closed job looking unpaid.
 * 2. Everything that names the invoice is found by discovery — every
 *    collection, `invoiceId ==` — and tenant-checked before it's deleted;
 *    its PDFs go from Storage by prefix; its audit events are kept but have
 *    their money removed.
 * 3. The invoice itself goes last, so a retry can always find what's left.
 * One tombstone audit event says it happened, with no amounts.
 */

type Db = Firestore;

export const deleteInvoiceRecordsInput = z.object({
  projectId: z.string().min(1).max(200),
  /** One bill; omitted, every invoice record on the job. */
  invoiceId: z.string().min(1).max(200).nullable().default(null),
  /** For a whole job: the job's name, typed. */
  confirmation: z.string().max(300).nullable().default(null),
});

type Context = {
  tenantId: string;
  membership: Record<string, unknown>;
  actorId: string;
  timestamp: string;
  idempotencyKey: string;
  ipAddress: string | null;
  userAgent: string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalName = (value: unknown) => text(value).toLowerCase().replace(/\s+/g, " ");

/** A provider or autopay is working on this invoice right now. */
export async function invoiceInFlight(db: Db, tenantId: string, invoice: DocumentSnapshot): Promise<boolean> {
  if (invoice.get("providerState") === "queued") return true;
  const [jobs, charges] = await Promise.all([
    db.collection("providerJobs").where("invoiceId", "==", invoice.id).limit(20).get(),
    db.collection("autopayCharges").where("invoiceId", "==", invoice.id).limit(20).get(),
  ]);
  const busy = (status: unknown) => ["queued", "running", "processing", "pending", "retry_scheduled"].includes(String(status));
  return (
    jobs.docs.some((job) => job.get("tenantId") === tenantId && busy(job.get("status"))) ||
    charges.docs.some((charge) => charge.get("tenantId") === tenantId && busy(charge.get("status")))
  );
}

/** Every collection the sweep may look in. */
export async function invoiceSweepCollections(db: Db): Promise<string[]> {
  const collections = await db.listCollections();
  return collections.map((item) => item.id).filter((name) => !INVOICE_PURGE_PROTECTED.includes(name)).sort();
}

/**
 * Delete everything that names this invoice, scrub its audit trail, then
 * the invoice. Idempotent: a second run finds nothing and deletes nothing.
 */
export async function sweepInvoiceRecords(
  db: Db,
  input: { tenantId: string; projectId: string; invoiceId: string; actorId: string; now: string; storage?: boolean },
): Promise<{ deleted: number; scrubbed: number; files: number }> {
  const { tenantId, invoiceId } = input;
  let deleted = 0;
  // 1. Discovery: anything carrying this invoice's id.
  for (const collection of await invoiceSweepCollections(db)) {
    for (;;) {
      const page = await db.collection(collection).where("invoiceId", "==", invoiceId).limit(200).get();
      const ours = page.docs.filter((item) => item.get("tenantId") === tenantId);
      if (!ours.length) break;
      const batch = db.batch();
      for (const item of ours) batch.delete(item.ref);
      await batch.commit();
      deleted += ours.length;
      if (page.size < 200) break;
    }
  }
  // Records that name it by id, not by field: Cue's payment reminders and a
  // booking change's "void the old invoice" task.
  const named = [
    ...Array.from({ length: PAYMENT_REMINDER.max }, (_, index) => `aiActions/ai_payment_reminder_${invoiceId}_${index + 1}`),
    `tasks/amendment_void_${invoiceId}`,
  ];
  for (const path of named) {
    const snapshot = await db.doc(path).get();
    if (snapshot.exists && snapshot.get("tenantId") === tenantId) {
      await snapshot.ref.delete();
      deleted += 1;
    }
  }
  // 2. Its PDFs (own invoicing): every revision, by prefix.
  let files = 0;
  if (input.storage !== false) {
    const prefix = `tenants/${tenantId}/projects/${input.projectId}/invoices/${invoiceId}/`;
    const bucket = getStorage().bucket();
    const [found] = await bucket.getFiles({ prefix });
    files = found.length;
    if (files) await bucket.deleteFiles({ prefix, force: true });
  }
  // 3. Its audit trail stays, without the money.
  let scrubbed = 0;
  const audits = await db.collection("auditEvents").where("entityId", "==", invoiceId).limit(500).get();
  for (const audit of audits.docs) {
    if (audit.get("tenantId") !== tenantId || audit.get("moneyScrubbedAt")) continue;
    await audit.ref.update({
      before: scrubMoney(audit.get("before") ?? null),
      after: scrubMoney(audit.get("after") ?? null),
      moneyScrubbedAt: input.now,
      moneyScrubbedBy: input.actorId,
    });
    scrubbed += 1;
  }
  // 4. Last: the invoice itself.
  const invoice = await db.doc(`invoiceReferences/${invoiceId}`).get();
  if (invoice.exists && invoice.get("tenantId") === tenantId) {
    await invoice.ref.delete();
    deleted += 1;
  }
  return { deleted, scrubbed, files };
}

export async function deleteInvoiceRecords(
  db: Db,
  context: Context,
  input: z.infer<typeof deleteInvoiceRecordsInput>,
  /** Tests run against Firestore alone; production always clears Storage too. */
  options: { storage?: boolean } = {},
) {
  if (!["studio_owner", "studio_admin"].includes(String(context.membership.role))) {
    throw new Error("INVOICE_DELETE_PERMISSION_REQUIRED");
  }
  const projectReference = db.doc(`projects/${input.projectId}`);
  const project = await projectReference.get();
  if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (!input.invoiceId && normalName(input.confirmation) !== normalName(project.get("name"))) {
    throw new Error("INVOICE_DELETE_CONFIRMATION_MISMATCH");
  }
  const all = (
    await db.collection("invoiceReferences").where("tenantId", "==", context.tenantId).where("projectId", "==", input.projectId).get()
  ).docs;
  const targets = input.invoiceId ? all.filter((invoice) => invoice.id === input.invoiceId) : all;
  if (input.invoiceId && !targets.length) throw new Error("INVOICE_NOT_FOUND");
  if (!targets.length) return { deleted: [], settled: [] as SettledKind[] };

  // Every bill must be deletable, or none is: a whole-job delete is all or nothing.
  const targetIds = new Set(targets.map((invoice) => invoice.id));
  const remaining = all.filter((invoice) => !targetIds.has(invoice.id)).map((invoice) => invoice.data());
  const jobHasFinalBalance = hasFinalBalance(projectProfile(project.data()));
  const plans = await Promise.all(
    targets.map(async (invoice) => ({
      invoice,
      plan: invoiceDeletePlan({
        invoice: invoice.data() ?? {},
        // Deleted together, a paid final counts for the deposit beside it.
        others: [...remaining, ...targets.filter((other) => other.id !== invoice.id).map((other) => other.data())],
        project: project.data(),
        jobHasFinalBalance,
        inFlight: await invoiceInFlight(db, context.tenantId, invoice),
      }),
    })),
  );
  const refused = plans.find((entry) => !entry.plan.allowed);
  if (refused && !refused.plan.allowed) throw new Error(refused.plan.reason);

  // 1. The settled notes and the "records deleted" mark, before anything goes.
  const settled = plans.flatMap((entry) => (entry.plan.allowed && entry.plan.settles ? [entry] : []));
  // Only a bill with money on it takes knowledge with it: once one goes, no
  // balance is worked out from what's left. Deleting an unpaid bill loses
  // nothing, and the job can be billed again as before.
  const losesPayments = targets.some(
    (invoice) => Number(invoice.get("amountCents") ?? 0) - Number(invoice.get("balanceCents") ?? 0) > 0,
  );
  const projectUpdate: Record<string, unknown> = {
    ...(losesPayments
      ? { "billing.recordsDeletedAt": context.timestamp, "billing.recordsDeletedBy": context.actorId }
      : {}),
    updatedAt: context.timestamp,
    updatedBy: context.actorId,
  };
  for (const entry of settled) {
    if (!entry.plan.allowed || !entry.plan.settles) continue;
    projectUpdate[`billing.settled.${entry.plan.settles}`] = {
      at: context.timestamp,
      by: context.actorId,
      deleted: true,
      ...(entry.plan.paidInFull ? { paidInFull: true } : {}),
    };
  }
  await projectReference.update(projectUpdate);

  // 2–4. Each bill's records, then the bill; one tombstone each.
  for (const { invoice } of plans) {
    await sweepInvoiceRecords(db, {
      tenantId: context.tenantId,
      projectId: input.projectId,
      invoiceId: invoice.id,
      actorId: context.actorId,
      now: context.timestamp,
      storage: options.storage,
    });
    const auditId = `audit_invoice_deleted_${createHash("sha256")
      .update(`${context.tenantId}:${context.idempotencyKey}:${invoice.id}`)
      .digest("hex")
      .slice(0, 32)}`;
    await db.doc(`auditEvents/${auditId}`).set({
      id: auditId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: "invoice.deleted",
      entityType: "invoiceReference",
      entityId: invoice.id,
      timestamp: context.timestamp,
      // What it was, never what it was for: no amounts.
      before: {
        number: text(invoice.get("number")) || text(invoice.get("providerDocNumber")) || null,
        kind: text(invoice.get("kind")) || null,
        source: text(invoice.get("provider")) || (invoice.get("billedBy") === "studio" ? "studio" : "recorded"),
        status: text(invoice.get("status")) || null,
      },
      after: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
      moneyScrubbedAt: context.timestamp,
    });
  }
  await projectReference.update({
    "billing.deletedInvoiceCount": (Number(project.get("billing.deletedInvoiceCount")) || 0) + plans.length,
  });
  return {
    deleted: plans.map((entry) => entry.invoice.id),
    settled: settled.flatMap((entry) => (entry.plan.allowed && entry.plan.settles ? [entry.plan.settles] : [])),
  };
}
