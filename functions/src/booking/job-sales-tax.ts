import { createHash } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { z } from "zod";

/**
 * "Don't charge sales tax on this job" — `projects.salesTaxExempt`.
 *
 * With the studio's sales tax on QuickBooks (billingSettings), every job is
 * taxed unless it is exempted here: a couple with a resale or exemption
 * certificate, a job out of state, a charity. Owner/admin only, audited, and
 * only through bookingCommand: firestore.rules refuses a browser write of the
 * field. Read with salesTaxApplies (billing/sales-tax-settings.ts).
 */
export const setJobSalesTaxExemptInput = z.object({
  projectId: z.string().min(1).max(200),
  exempt: z.boolean(),
});

export async function setJobSalesTaxExempt(
  context: {
    tenantId: string;
    membership: Record<string, unknown>;
    actorId: string;
    timestamp: string;
    idempotencyKey: string;
    ipAddress: string | null;
    userAgent: string | null;
  },
  input: z.infer<typeof setJobSalesTaxExemptInput>,
) {
  if (!["studio_owner", "studio_admin"].includes(String(context.membership.role))) {
    throw new Error("SALES_TAX_PERMISSION_REQUIRED");
  }
  const db = getFirestore();
  const projectReference = db.doc(`projects/${input.projectId}`);
  const auditId = `audit_sales_tax_exempt_${createHash("sha256")
    .update(`${context.tenantId}:${context.idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
  return db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectReference);
    if (!project.exists || project.get("tenantId") !== context.tenantId) throw new Error("PROJECT_NOT_FOUND");
    const before = project.get("salesTaxExempt") === true;
    transaction.update(projectReference, {
      salesTaxExempt: input.exempt,
      updatedAt: context.timestamp,
      updatedBy: context.actorId,
    });
    transaction.create(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId: context.tenantId,
      projectId: input.projectId,
      actorId: context.actorId,
      actorType: "user",
      action: input.exempt ? "billing.job_sales_tax_exempted" : "billing.job_sales_tax_restored",
      entityType: "project",
      entityId: input.projectId,
      timestamp: context.timestamp,
      before: { salesTaxExempt: before },
      after: { salesTaxExempt: input.exempt },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      correlationId: context.idempotencyKey,
      automationRunId: null,
      providerEventId: null,
    });
    return { projectId: input.projectId, salesTaxExempt: input.exempt };
  });
}
