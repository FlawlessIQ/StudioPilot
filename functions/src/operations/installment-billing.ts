import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { raiseInstallmentInvoice } from "../booking/installment-invoice.js";
import { jobBillingFor } from "../billing/job-billing-reader.js";
import { nextInstallmentToBill } from "../billing/payment-plan.js";
import { hasFinalBalance, projectProfile } from "../job-kinds/job-kinds.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";

/**
 * The daily run's payment-plan pass (billing/payment-plan.ts): each booked
 * job's next installment, two weeks before it falls due.
 *
 * Runs inside finalInvoiceScheduler, before the final balances, so an
 * installment and the final falling due together are billed in that order
 * and the final nets the installment off. No Cloud Function of its own.
 *
 * Exactly the final balance's guards: booked and ahead (BOOKED, PLANNING,
 * READY), a deposit job, and never a job put away, called off, on hold — or
 * a quiet imported booking, which is usually billed elsewhere already. And
 * as for the final, the run never resolves an invoicing customer: a deposit
 * recorded by hand leaves the installment on Today for the studio.
 */

/** Booked and still ahead: the only jobs an installment is raised for. */
const PLAN_STATES = ["BOOKED", "PLANNING", "READY"];

/** Pure: whether the daily run may raise this job's next installment. */
export function mayRaiseInstallmentBill(project: unknown, today: string): boolean {
  const fields = (project ?? {}) as { state?: unknown; eventDate?: unknown };
  if (!hasFinalBalance(projectProfile(project))) return false;
  if (!PLAN_STATES.includes(String(fields.state ?? ""))) return false;
  const eventDate = typeof fields.eventDate === "string" ? fields.eventDate : "";
  if (!eventDate || eventDate < today) return false;
  return clientOutreachStop(project) === null;
}

/**
 * Pure: an installment the daily run leaves to the studio — one with an
 * earlier bill that was voided or refused (anything but superseded by a
 * booking change, which the run raises again at the new figure).
 */
export function installmentRetriedByStudio(invoices: ReadonlyArray<Record<string, unknown>>, sequence: number): boolean {
  return invoices.some(
    (invoice) =>
      invoice.kind === "installment" &&
      Number(invoice.installmentSequence) === sequence &&
      invoice.status !== "superseded",
  );
}

export async function raiseDueInstallments(db: Firestore, today: string): Promise<void> {
  // Two equality filters: served by Firestore's single-field indexes, no
  // composite index. Only accepted proposals that carry a plan.
  const planned: DocumentSnapshot[] = [];
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db
      .collection("proposals")
      .where("hasPaymentPlan", "==", true)
      .where("status", "==", "accepted")
      .limit(300);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    planned.push(...page.docs);
    if (page.size < 300) break;
    last = page.docs[page.docs.length - 1]!;
  }
  const projectIds = [...new Set(planned.map((proposal) => String(proposal.get("projectId") ?? "")).filter(Boolean))];
  const projects = new Map<string, DocumentSnapshot>();
  for (let start = 0; start < projectIds.length; start += 100) {
    const snapshots = await db.getAll(...projectIds.slice(start, start + 100).map((id) => db.doc(`projects/${id}`)));
    for (const snapshot of snapshots) if (snapshot.exists) projects.set(snapshot.id, snapshot);
  }
  for (const proposal of planned) {
    const project = projects.get(String(proposal.get("projectId") ?? ""));
    // Another tenant's project id on this proposal is not this proposal's job.
    if (!project || project.get("tenantId") !== proposal.get("tenantId")) continue;
    if (!mayRaiseInstallmentBill(project.data(), today)) continue;
    const tenantId = String(project.get("tenantId"));
    try {
      // Cheap first look outside the transaction; the transaction decides again.
      const invoices = await db
        .collection("invoiceReferences")
        .where("tenantId", "==", tenantId)
        .where("projectId", "==", project.id)
        .limit(60)
        .get();
      const due = nextInstallmentToBill({
        schedule: proposal.get("paymentSchedule"),
        invoices: invoices.docs.map((invoice) => invoice.data() as Record<string, unknown>),
        today,
      });
      if (!due) continue;
      // An earlier bill for this installment that a person voided, or that
      // the provider refused, is the studio's to send again (Today's card,
      // sendInstallment) — as a voided or failed final is. Only one a booking
      // change superseded is raised again here, at its new figure.
      if (
        installmentRetriedByStudio(
          invoices.docs.map((invoice) => invoice.data() as Record<string, unknown>),
          due.sequence,
        )
      ) {
        console.info("installment not raised", project.id, due.sequence, "earlier_attempt");
        continue;
      }
      const billing = await jobBillingFor(db, tenantId, project.id, project.data() ?? null);
      const outcome = await db.runTransaction((transaction) =>
        raiseInstallmentInvoice(db, transaction, project, {
          actor: "installment-scheduler",
          now: new Date().toISOString(),
          today,
          billing,
        }),
      );
      // A plan installment that is due and never billed must leave a reason.
      if (!outcome.raised) console.info("installment not raised", project.id, due.sequence, outcome.reason);
    } catch (caught: unknown) {
      // One job failing must not stop every job after it from being billed.
      console.error("installment not raised", project.id, caught);
    }
  }
}
