import { getFirestore, type DocumentSnapshot } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { raiseFinalInvoice } from "../booking/final-invoice.js";
import { draftPaymentReminders } from "../billing/payment-reminders.js";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { hasFinalBalance, journeyFor, projectProfile } from "../job-kinds/job-kinds.js";
import { TRADES, tradeProfile } from "../trades/trades.js";
import { jobBillingFor } from "../billing/job-billing-reader.js";

const date = (value: Date) => value.toISOString().slice(0, 10);

/** A calendar day moved by whole days. */
function shiftDay(day: string, days: number): string {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return date(value);
}

/**
 * How long a client has to pay a final bill before it falls due: two weeks.
 * A photographer's and a DJ's balance falls due two weeks before the day
 * (trades.ts `balanceDueDaysBefore`), so their bill is raised four weeks out,
 * as it always has been.
 */
export const FINAL_BILL_LEAD_DAYS = 14;

/** Days before the event a trade's final bill is raised: its due date, less the time to pay. */
export function finalBillRaiseDaysBefore(trade: unknown): number {
  return tradeProfile(trade).balanceDueDaysBefore + FINAL_BILL_LEAD_DAYS;
}

/**
 * The widest of those windows, which the daily run reads every job inside.
 * The run's own window (`+ 28` below) must be at least this; the Phase 4
 * test holds the two together.
 */
export const FINAL_BILL_WINDOW_DAYS = Math.max(...TRADES.map(finalBillRaiseDaysBefore));

/**
 * A job whose balance is collected on the morning — a makeup artist's or a
 * hair stylist's (job-kinds.ts `journeyFor`, `balanceOnTheDay`).
 *
 * Their client is not sent a bill weeks ahead: the studio takes the balance
 * on the day and records it in one tap (simpler vendor journeys, Phase 4).
 * The one exception is a client who saved a card for autopay. Their bill is
 * raised the day before, due on the morning, so QuickBooks has it when
 * autopay charges the card that day (billing/autopay.ts).
 */
export function balanceCollectedOnTheDay(project: unknown, trade: unknown): boolean {
  return journeyFor(projectProfile(project), tradeProfile(trade)).balanceOnTheDay;
}

/** How many days ahead an on-the-day balance with a saved card is billed. */
export const ON_THE_DAY_AUTOPAY_RAISE_DAYS_BEFORE = 1;

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

/**
 * Pure: whether the daily run may raise this job's final bill.
 *
 * `trade` is the studio's (tenants/{id}.trade); missing is a photographer, so
 * a caller that passes none gets exactly what the run always did.
 * `autopayCard` is whether the client saved a card and the studio has
 * autopay on — read only for a balance collected on the day.
 */
export function mayRaiseFinalBill(
  project: unknown,
  today: string,
  horizon: string,
  context: { trade?: unknown; autopayCard?: boolean } = {},
): boolean {
  const fields = (project ?? {}) as { state?: unknown; eventDate?: unknown };
  // Only a deposit leaves a balance to bill before the day (job-kinds.ts):
  // a job paid in full has nothing owed, and one paid on the day or invoiced
  // after is offered on Today (singleBillWindow) — there is no customer to
  // bill yet, and nothing new is billed without someone choosing to.
  if (!hasFinalBalance(projectProfile(project))) return false;
  if (!FINAL_BILL_STATES.includes(String(fields.state ?? ""))) return false;
  const eventDate = typeof fields.eventDate === "string" ? fields.eventDate : "";
  if (!eventDate || eventDate < today || eventDate > horizon) return false;
  // The trade's own window: four weeks for a photographer or a DJ. A balance
  // taken on the morning is never billed ahead, unless autopay will charge it.
  const raiseDaysBefore = balanceCollectedOnTheDay(project, context.trade)
    ? context.autopayCard
      ? ON_THE_DAY_AUTOPAY_RAISE_DAYS_BEFORE
      : null
    : finalBillRaiseDaysBefore(context.trade);
  if (raiseDaysBefore === null || eventDate > shiftDay(today, raiseDaysBefore)) return false;
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
     * days out. Twenty-eight is the widest trade's window
     * (FINAL_BILL_WINDOW_DAYS); each job is then held to its own trade's.
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

    // Each studio's trade decides its window (trades.ts), and whether autopay
    // is on for the one case that reads it.
    const tenantIds = [
      ...new Set(inWindow.map((project) => String(project.get("tenantId") ?? "")).filter(Boolean)),
    ];
    const tenants = new Map<string, DocumentSnapshot>();
    for (let start = 0; start < tenantIds.length; start += 100) {
      const snapshots = await db.getAll(
        ...tenantIds.slice(start, start + 100).map((id) => db.doc(`tenants/${id}`)),
      );
      for (const snapshot of snapshots) if (snapshot.exists) tenants.set(snapshot.id, snapshot);
    }

    for (const project of inWindow) {
      const tenantId = String(project.get("tenantId") ?? "");
      const tenant = tenants.get(tenantId);
      const trade = tenant?.get("trade");
      // A saved card matters only for a balance taken on the morning, from
      // the day before, at a studio with autopay on.
      const eventDate = String(project.get("eventDate") ?? "");
      const autopayCard =
        balanceCollectedOnTheDay(project.data(), trade) &&
        eventDate <= shiftDay(date(today), ON_THE_DAY_AUTOPAY_RAISE_DAYS_BEFORE) &&
        (tenant?.get("autopay") as { enabled?: unknown } | undefined)?.enabled === true &&
        !(
          await db
            .collection("paymentMethods")
            .where("tenantId", "==", tenantId)
            .where("projectId", "==", project.id)
            .where("status", "==", "active")
            .limit(1)
            .get()
        ).empty;
      if (!mayRaiseFinalBill(project.data(), date(today), date(target), { trade, autopayCard })) continue;
      try {
        const billing = await jobBillingFor(db, tenantId, project.id, project.data() ?? null);
        const outcome = await db.runTransaction((transaction) =>
          raiseFinalInvoice(db, transaction, project, {
            invoiceId: `final_${project.id}`,
            actor: "final-invoice-scheduler",
            now: new Date().toISOString(),
            billing,
          }),
        );
        // Every skip is findable: a balance that is owed and never billed
        // must leave a reason behind (own-invoicing plan, Phase 0).
        if (!outcome.raised) console.info("final invoice not raised", project.id, outcome.reason);
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

    // Cue drafts a reminder for each bill past due; the studio sends it from
    // Today with one tap (billing/payment-reminders.ts). The same invoices,
    // with each job already read and checked against the invoice's tenant.
    const owned = new Map<string, Record<string, unknown>>();
    for (const [id, project] of projects) owned.set(id, (project ?? {}) as Record<string, unknown>);
    await draftPaymentReminders(db, overdue.docs, owned, new Date());
  },
);
