import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { quickBooksReady } from "../billing/job-billing-reader.js";
import { requireProviderForTenant } from "../integrations/capability-resolution.js";
import { agreedRetainerCents } from "./agreed-retainer.js";
import { invoiceVoidRefusal, type CorrectableInvoice } from "./invoice-corrections-core.js";
import { writeInvoiceVoid } from "./invoice-corrections.js";
import { isStandingInvoice } from "./invoice-standing.js";

/**
 * "Bill this job through QuickBooks / Bill it myself" — `projects.billing`.
 *
 * Job by job, never studio-wide (features/billing/job-billing.ts). Choosing
 * QuickBooks needs QuickBooks connected now; choosing to bill it yourself is
 * always allowed. Bills already raised stay where they are; only new bills
 * follow the choice. The choice is also kept as the studio's
 * `billingSettings.lastJobBillingMethod`, which decides nothing.
 *
 * Moving a job to QuickBooks takes its unpaid StudioCue bills with it: each
 * is voided (the client's PDF says VOID), and a voided deposit on a job
 * still waiting for it is raised at QuickBooks at once, as "Create deposit
 * invoice" would, so the client gets one with QuickBooks' pay link. Before,
 * the switch left the StudioCue deposit standing and refused a QuickBooks
 * one beside it — a dead end (GR, Michelle & Kyle, 2026-10-21). A bill with
 * money on it stays where it is.
 *
 * Owner/admin only, audited, and only through bookingCommand:
 * firestore.rules refuses every browser write to a job.
 */
export const setJobBillingMethodInput = z.object({
  projectId: z.string().min(1).max(200),
  method: z.enum(["quickbooks", "studio"]),
});

export async function setJobBillingMethod(
  context: {
    tenantId: string;
    membership: Record<string, unknown>;
    actorId: string;
    timestamp: string;
    idempotencyKey: string;
    ipAddress: string | null;
    userAgent: string | null;
  },
  input: z.infer<typeof setJobBillingMethodInput>,
) {
  if (!["studio_owner", "studio_admin"].includes(String(context.membership.role))) {
    throw new Error("BILLING_PERMISSION_REQUIRED");
  }
  const db = getFirestore();
  if (input.method === "quickbooks" && !(await quickBooksReady(db, context.tenantId))) {
    throw new Error("QUICKBOOKS_NOT_CONNECTED");
  }
  const mockMode = process.env.PROVIDER_MOCK_MODE === "true";
  // Read outside the transaction (as createRetainerInvoice does): the
  // provider and what the client agreed to pay up front.
  const toQuickBooks = input.method === "quickbooks";
  const before0 = toQuickBooks ? await db.doc(`projects/${input.projectId}`).get() : null;
  const snapshotId = String(before0?.get("packageSnapshotId") ?? "");
  const packageSnapshot = snapshotId ? await db.doc(`packageSnapshots/${snapshotId}`).get() : null;
  const depositProvider = toQuickBooks
    ? mockMode
      ? "quickbooks"
      : await requireProviderForTenant(db, context.tenantId, "invoicing")
    : null;
  const depositCents =
    toQuickBooks && packageSnapshot?.exists && packageSnapshot.get("tenantId") === context.tenantId
      ? await agreedRetainerCents(db, context.tenantId, input.projectId, packageSnapshot)
      : 0;
  const depositId = `invoice_${createHash("sha256").update(`${context.tenantId}:${context.idempotencyKey}:moved_deposit`).digest("hex").slice(0, 32)}`;
  const projectReference = db.doc(`projects/${input.projectId}`);
  const settingsReference = db.doc(`billingSettings/${context.tenantId}`);
  const auditId = `audit_job_billing_${createHash("sha256")
    .update(`${context.tenantId}:${context.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
  return db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectReference);
    if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
    const before = (project.get("billing.method") as string | undefined) ?? null;
    const bills = toQuickBooks
      ? (
          await transaction.get(
            db.collection("invoiceReferences").where("tenantId", "==", context.tenantId).where("projectId", "==", input.projectId),
          )
        ).docs
      : [];
    const studioBills = bills.filter(
      (bill) => bill.get("billedBy") === "studio" && !bill.get("provider") && isStandingInvoice(bill.get("status")),
    );
    const moving = studioBills.filter((bill) => invoiceVoidRefusal((bill.data() ?? {}) as CorrectableInvoice) === null);
    const kept = studioBills.filter((bill) => !moving.includes(bill));
    const movedDeposit = moving.find((bill) => bill.get("kind") === "retainer") ?? null;
    // Only a job still waiting on its deposit, with nothing standing in its
    // place once the StudioCue one is void, gets one raised at QuickBooks.
    const raiseDeposit =
      Boolean(movedDeposit) &&
      project.get("state") === "RETAINER_PENDING" &&
      Boolean(packageSnapshot?.exists) &&
      depositCents > 0 &&
      !bills.some(
        (bill) => bill.get("kind") === "retainer" && bill.id !== movedDeposit?.id && isStandingInvoice(bill.get("status")),
      );
    transaction.update(projectReference, {
      "billing.method": input.method,
      "billing.chosenAt": context.timestamp,
      "billing.chosenBy": context.actorId,
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    for (const bill of moving)
      writeInvoiceVoid(db, transaction, {
        invoice: bill,
        reason: "Moved to QuickBooks",
        source: "studio",
        actor: context.actorId,
        now: context.timestamp,
      });
    if (raiseDeposit && movedDeposit) {
      const today = context.timestamp.slice(0, 10);
      const due = String(movedDeposit.get("dueDate") ?? "");
      const providerInvoiceId = mockMode ? `qbo_invoice_${context.idempotencyKey}` : null;
      transaction.create(db.doc(`invoiceReferences/${depositId}`), {
        id: depositId,
        tenantId: context.tenantId,
        projectId: input.projectId,
        kind: "retainer",
        provider: depositProvider,
        providerInvoiceId,
        providerCustomerId: `pending_${input.projectId}`,
        // Not "sent" until QuickBooks has it (createRetainerInvoice).
        status: mockMode ? "sent" : "queued",
        currency: packageSnapshot?.get("currency") ?? "USD",
        amountCents: depositCents,
        balanceCents: depositCents,
        dueDate: due && due >= today ? due : today,
        hostedUrl: mockMode ? `https://pay.example.test/${providerInvoiceId}` : null,
        lastSyncedAt: context.timestamp,
        lastProviderEventId: null,
        providerState: mockMode ? "completed_mock" : "queued",
        replaces: movedDeposit.id,
        createdAt: context.timestamp,
        updatedAt: context.timestamp,
        createdBy: context.actorId,
        updatedBy: context.actorId,
        archivedAt: null,
      });
      if (!mockMode)
        transaction.create(db.doc(`providerJobs/invoice_${depositId}`), {
          tenantId: context.tenantId,
          projectId: input.projectId,
          type: depositProvider === "stripe" ? "create_stripe_invoice" : "create_quickbooks_invoice",
          invoiceId: depositId,
          idempotencyKey: `${context.idempotencyKey}:moved_deposit`,
          status: "queued",
          attempts: 0,
          createdAt: context.timestamp,
          updatedAt: context.timestamp,
        });
    }
    transaction.set(
      settingsReference,
      { tenantId: context.tenantId, lastJobBillingMethod: input.method },
      { merge: true },
    );
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: "billing.job_method_set",
      entityType: "project",
      entityId: input.projectId,
      timestamp: context.timestamp,
      before: { method: before },
      after: {
        method: input.method,
        ...(moving.length ? { voided: moving.map((bill) => bill.get("number") ?? bill.id) } : {}),
        ...(raiseDeposit ? { depositRaised: depositId } : {}),
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return {
      projectId: input.projectId,
      method: input.method,
      voided: moving.map((bill) => String(bill.get("number") ?? bill.id)),
      kept: kept.map((bill) => String(bill.get("number") ?? bill.id)),
      depositRaised: raiseDeposit,
    };
  });
}
