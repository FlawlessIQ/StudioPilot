import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { raiseFinalInvoice } from "../booking/final-invoice.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { hasFinalBalance, projectProfile } from "../job-kinds/job-kinds.js";

const date = (value: Date) => value.toISOString().slice(0, 10);

/** Booked and still ahead: the only jobs a final bill is raised for. */
const FINAL_BILL_STATES = ["BOOKED", "PLANNING", "READY"];

/**
 * Statuses the overdue sweep never touches.
 *
 * Not owed: voided, refunded, paid, superseded (a booking change or a
 * cancellation replaced it), failed (it never reached the provider).
 *
 * Not billed yet: `draft` and `review_required` finals are waiting on the
 * studio or the provider worker, and `queued` has not been created. Sweeping
 * those to `overdue` turned a bill nobody had sent into one autopay would
 * charge (money audit, 2026-09-30).
 */
const NEVER_OVERDUE = [
  "voided",
  "void",
  "refunded",
  "paid",
  "superseded",
  "failed",
  "cancelled",
  "draft",
  "review_required",
  "queued",
];

/** Pure: whether the sweep may mark this invoice overdue. */
export function mayMarkOverdue(
  invoice: { status?: unknown; balanceCents?: unknown; dueDate?: unknown; providerState?: unknown },
  project: unknown,
  today: string,
): boolean {
  if (NEVER_OVERDUE.includes(String(invoice.status))) return false;
  if (!(Number(invoice.balanceCents) > 0)) return false;
  const dueDate = typeof invoice.dueDate === "string" ? invoice.dueDate.slice(0, 10) : "";
  if (!dueDate || dueDate >= today) return false;
  // Not yet raised at the provider — the couple has no bill to be late on.
  // An invoice StudioCue never sends anywhere (imported) has no provider
  // state to wait for.
  if (invoice.providerState !== undefined && invoice.providerState !== null &&
    !["completed", "not_applicable"].includes(String(invoice.providerState)))
    return false;
  // A job put away, called off or on hold is not being chased. A quiet
  // imported booking still shows what is late; nothing is sent because of it.
  const stop = clientOutreachStop(project);
  if (!project || (stop && stop !== "automations_paused")) return false;
  return true;
}

/** Pure: whether the daily run may raise this job's final bill. */
export function mayRaiseFinalBill(project: unknown, today: string, horizon: string): boolean {
  const fields = (project ?? {}) as { state?: unknown; eventDate?: unknown };
  // Only a deposit leaves a balance to bill before the day (job-kinds.ts):
  // a job paid in full has nothing owed, and one paid on the day or invoiced
  // after is offered on Today (singleBillWindow) — there is no customer to
  // bill yet, and nothing new is billed without someone choosing to.
  if (!hasFinalBalance(projectProfile(project))) return false;
  if (!FINAL_BILL_STATES.includes(String(fields.state ?? ""))) return false;
  const eventDate = typeof fields.eventDate === "string" ? fields.eventDate : "";
  if (!eventDate || eventDate < today || eventDate > horizon) return false;
  // Archived, called off, on hold — and a quiet imported booking, which is
  // usually billed elsewhere already; raising and emailing a final invoice
  // would be a second bill for one wedding.
  return clientOutreachStop(project) === null;
}

export const finalInvoiceScheduler = onSchedule(
  {
    schedule: "every day 06:00",
    timeZone: "UTC",
    retryCount: 3,
  },
  async () => {
    const db = getFirestore();
    const today = new Date();
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() + 28);
    /**
     * Every booked job inside the 28-day window, not only the one exactly 28
     * days out.
     *
     * An exact match meant a job booked or moved inside the window, or a day
     * this run failed, was never billed. The window catches up; the fixed
     * `final_<projectId>` id and raiseFinalInvoice's own checks (a final
     * already out, nothing owed) keep a daily re-run from raising a second
     * bill. A range on eventDate alone needs no composite index; the state is
     * filtered here, as lifecycle-scheduler.ts does.
     */
    const inWindow: DocumentSnapshot[] = [];
    let last: DocumentSnapshot | null = null;
    for (;;) {
      let query = db
        .collection("projects")
        .where("eventDate", ">=", date(today))
        .where("eventDate", "<=", date(target))
        .orderBy("eventDate")
        .limit(300);
      if (last) query = query.startAfter(last);
      const page = await query.get();
      inWindow.push(...page.docs);
      if (page.size < 300) break;
      last = page.docs[page.docs.length - 1]!;
    }

    for (const project of inWindow) {
      if (!mayRaiseFinalBill(project.data(), date(today), date(target))) continue;
      try {
        await db.runTransaction((transaction) =>
          raiseFinalInvoice(db, transaction, project, {
            invoiceId: `final_${project.id}`,
            actor: "final-invoice-scheduler",
            now: new Date().toISOString(),
          }),
        );
      } catch (caught: unknown) {
        // One job failing must not stop every job after it from being billed.
        console.error("final invoice not raised", project.id, caught);
      }
    }

    const overdue = await db
      .collection("invoiceReferences")
      .where("balanceCents", ">", 0)
      .where("dueDate", "<", date(today))
      .limit(200)
      .get();
    const projectIds = [
      ...new Set(overdue.docs.map((invoice) => String(invoice.get("projectId") ?? "")).filter(Boolean)),
    ];
    const projects = new Map<string, unknown>();
    for (let start = 0; start < projectIds.length; start += 100) {
      const snapshots = await db.getAll(
        ...projectIds.slice(start, start + 100).map((id) => db.doc(`projects/${id}`)),
      );
      for (const snapshot of snapshots) if (snapshot.exists) projects.set(snapshot.id, snapshot.data());
    }
    const batch = db.batch();
    let marked = 0;
    for (const invoice of overdue.docs) {
      if (String(invoice.get("status")) === "overdue") continue;
      const project = projects.get(String(invoice.get("projectId") ?? ""));
      // Another tenant's project id on this invoice is not this invoice's job.
      if ((project as { tenantId?: unknown } | undefined)?.tenantId !== invoice.get("tenantId")) continue;
      if (!mayMarkOverdue(invoice.data(), project, date(today))) continue;
      batch.update(invoice.ref, {
        status: "overdue",
        updatedAt: new Date().toISOString(),
        updatedBy: "invoice-scheduler",
      });
      marked += 1;
    }
    if (marked) await batch.commit();
  },
);
