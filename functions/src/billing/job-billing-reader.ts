import type { Firestore } from "firebase-admin/firestore";
import { requireProviderForTenant } from "../integrations/capability-resolution.js";
import { isQuickBooksBill, jobBilling, type JobBilling } from "./job-billing.js";

/**
 * Whether QuickBooks resolves as the studio's invoicing provider now.
 * Stripe is not offered for client billing, so it never counts.
 */
export async function quickBooksReady(db: Firestore, tenantId: string): Promise<boolean> {
  try {
    return (await requireProviderForTenant(db, tenantId, "invoicing")) === "quickbooks";
  } catch {
    return false;
  }
}

/**
 * How one job is billed (features/billing/job-billing.ts), read from the
 * studio's connections, the job's own bills and the studio's last choice.
 *
 * Every path that raises a bill asks this first: the deposit on signing,
 * the deposit for a job with no agreement, "Create retainer invoice", the
 * final bill and the agreement send that decides whether signing raises a
 * deposit at all. Pass `project` when the caller already holds it.
 */
export async function jobBillingFor(
  db: Firestore,
  tenantId: string,
  projectId: string,
  project?: Record<string, unknown> | null,
): Promise<JobBilling> {
  const [ready, projectData, invoices, settings] = await Promise.all([
    quickBooksReady(db, tenantId),
    project !== undefined
      ? Promise.resolve(project)
      : db.doc(`projects/${projectId}`).get().then((snapshot) =>
          snapshot.exists && snapshot.get("tenantId") === tenantId ? (snapshot.data() ?? null) : null,
        ),
    db
      .collection("invoiceReferences")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .get(),
    db.doc(`billingSettings/${tenantId}`).get(),
  ]);
  return jobBilling({
    project: projectData,
    quickbooksReady: ready,
    hasQuickBooksBills: invoices.docs.some((invoice) =>
      isQuickBooksBill({ provider: invoice.get("provider"), status: invoice.get("status") }),
    ),
    lastChoice: settings.exists && settings.get("tenantId") === tenantId ? settings.get("lastJobBillingMethod") : null,
  });
}

/** Thrown where a QuickBooks-only action is asked of a job the studio bills itself. */
export const STUDIO_BILLED_JOB = "BILLING_STUDIO_JOB";
