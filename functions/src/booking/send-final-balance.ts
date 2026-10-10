import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { resolveProviderForTenant } from "../integrations/capability-resolution.js";
import { jobBillingFor } from "../billing/job-billing-reader.js";
import { balanceMayBeAttested } from "./agreed-final-balance.js";
import { raiseFinalInvoice } from "./final-invoice.js";
import { bookingGateNeeds, projectProfile, singleBillDueDate } from "../job-kinds/job-kinds.js";

/**
 * "Send the final bill", asked for by a person.
 *
 * The daily scheduler raises a final invoice on one day only — 28 days before
 * the wedding — and only when the retainer carries an invoicing customer. A
 * job booked inside that window, moved inside it, or whose retainer was
 * recorded by hand was never billed, while Today and the job page said "Send
 * final invoice" and linked to a page that could not send one. This is that
 * missing button. The amount is never the browser's: it is the accepted
 * proposal's total less everything paid (final-invoice.ts).
 */

export const sendFinalBalanceInput = z.object({
  projectId: z.string().min(1),
});

const REASON_TO_ERROR: Record<string, string> = {
  exists: "FINAL_INVOICE_ALREADY_OUT",
  final_outstanding: "FINAL_INVOICE_ALREADY_OUT",
  nothing_owed: "NOTHING_OWED",
  no_retainer: "FINAL_NEEDS_RETAINER_RECORD",
  no_package: "FINAL_NO_PACKAGE",
  no_provider_customer: "INVOICING_NOT_CONNECTED",
  studio_billed: "BILLING_STUDIO_JOB",
  records_deleted: "INVOICE_RECORDS_DELETED",
};

export async function sendFinalBalance(
  db: Firestore,
  input: {
    tenantId: string;
    projectId: string;
    role: string;
    actorId: string;
    mockMode: boolean;
  },
) {
  if (!["studio_owner", "studio_admin"].includes(input.role)) throw new Error("BALANCE_ATTESTATION_PERMISSION_REQUIRED");
  const project = await db.doc(`projects/${input.projectId}`).get();
  if (!project.exists || project.get("tenantId") !== input.tenantId) throw new Error("PROJECT_NOT_FOUND");
  if (project.get("archivedAt")) throw new Error("PROJECT_ARCHIVED");
  if (!balanceMayBeAttested(String(project.get("state")))) throw new Error("BALANCE_NOT_READY");

  // A job the studio bills itself never goes to QuickBooks from here
  // (billing/job-billing.ts): its final is drafted as the studio's own
  // invoice, numbered with its PDF, for the studio to check and send
  // (own invoicing, Phase 3).
  const billing = await jobBillingFor(db, input.tenantId, input.projectId, project.data() ?? null);
  const studioBilled = billing.method === "studio";
  const provider = studioBilled
    ? "studio"
    : ((await resolveProviderForTenant(db, input.tenantId, "invoicing", "quickbooks")) as string);
  if (!studioBilled && provider !== "quickbooks" && provider !== "stripe") throw new Error("INVOICING_NOT_CONNECTED");
  if (!studioBilled && !input.mockMode) {
    const connections = await db
      .collection("integrationConnections")
      .where("tenantId", "==", input.tenantId)
      .where("provider", "==", provider)
      .limit(5)
      .get();
    if (!connections.docs.some((connection) => connection.get("status") === "connected"))
      throw new Error("INVOICING_NOT_CONNECTED");
  }

  // The first final keeps the scheduler's id, so the two can never both raise
  // one; a later one (after a superseded or failed attempt) takes a new id.
  const primary = `final_${input.projectId}`;
  const invoiceId = (await db.doc(`invoiceReferences/${primary}`).get()).exists
    ? `${primary}_m${Date.now().toString(36)}`
    : primary;
  const outcome = await db.runTransaction((transaction) =>
    raiseFinalInvoice(db, transaction, project, {
      invoiceId,
      actor: input.actorId,
      now: new Date().toISOString(),
      ...(studioBilled ? {} : { provider: provider as "quickbooks" | "stripe" }),
      billing,
      resolveCustomer: true,
      // Booked with nothing paid (paid on the day, invoiced after): this bill
      // is the whole price, not a balance after a retainer (job-kinds.ts).
      billedWithoutRetainer: !bookingGateNeeds(projectProfile(project.data())).payment,
      // Due on the day, or thirty days after it — not a fortnight before.
      dueDate: singleBillDueDate(project.data()) ?? undefined,
    }),
  );
  if (!outcome.raised) throw new Error(REASON_TO_ERROR[outcome.reason] ?? "FINAL_INVOICE_NOT_RAISED");
  return { ...outcome, provider, ...(studioBilled ? { studioInvoice: true } : {}) };
}
