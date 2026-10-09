import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";
import { quickBooksReady } from "../billing/job-billing-reader.js";

/**
 * "Bill this job through QuickBooks / Bill it myself" — `projects.billing`.
 *
 * Job by job, never studio-wide (features/billing/job-billing.ts). Choosing
 * QuickBooks needs QuickBooks connected now; choosing to bill it yourself is
 * always allowed. Bills already raised stay where they are; only new bills
 * follow the choice. The choice is also kept as the studio's
 * `billingSettings.lastJobBillingMethod`, which only pre-selects the next
 * job's question and decides nothing.
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
    transaction.update(projectReference, {
      "billing.method": input.method,
      "billing.chosenAt": context.timestamp,
      "billing.chosenBy": context.actorId,
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
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
      after: { method: input.method },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { projectId: input.projectId, method: input.method };
  });
}
