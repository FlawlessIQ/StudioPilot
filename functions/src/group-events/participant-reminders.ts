import { randomBytes } from "node:crypto";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import {
  GROUP_BALANCE_EMAIL,
  GROUP_REMINDER_EMAIL,
  balanceDue,
  participantBalanceDecision,
  participantBalancePlan,
  eventRemindersOn,
  eventWhere,
  participantReminderDecision,
  participantReminderPlan,
  reminderDue,
  type ParticipantReminderPlan,
} from "./participant-reminders-core.js";

/**
 * The day-before note to each parent or family at a group event — the
 * Firestore half (rules in participant-reminders-core.ts). Run by the hourly
 * event-reminder sweep (communications/event-reminders.ts), so "9 AM the day
 * before" is 9 AM in each event's own zone. Each email's id is its
 * idempotency key: a rerun or a second instance sends nothing twice.
 */

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
const ACTOR = "event-reminder-scheduler";

export async function remindParticipants(
  db: Firestore,
  project: DocumentSnapshot,
  zone: string,
  now: Date,
  tally: Record<string, number>,
): Promise<void> {
  const data = project.data() ?? {};
  const count = (key: string) => (tally[key] = (tally[key] ?? 0) + 1);
  // Cheap checks first: the roster is read only on the event's reminder day,
  // or the days after it when a balance nudge is due.
  if (!eventRemindersOn(data).on) return;
  const beforeDue = reminderDue(data, now, zone) === "due";
  const afterDue = balanceDue(data, now, zone) === "due";
  if (!beforeDue && !afterDue) return;
  const tenantId = text(data.tenantId);
  const roster = await db
    .collection("eventParticipants")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", project.id)
    .get();
  for (const participant of roster.docs) {
    const row = participant.data();
    const kind = beforeDue ? GROUP_REMINDER_EMAIL : GROUP_BALANCE_EMAIL;
    const decision = beforeDue
      ? participantReminderDecision({ project: data, participantId: participant.id, participant: row, now, zone })
      : participantBalanceDecision({ project: data, participantId: participant.id, participant: row, now, zone });
    if (!decision.send) {
      count(`group_${decision.reason}`);
      continue;
    }
    const reference = db.doc(`emailJobs/${decision.id}`);
    if ((await reference.get()).exists) {
      count("group_already");
      continue;
    }
    // Their own order page is the email's link; someone the studio added by
    // hand gets one now, as their receipt would.
    let orderToken = text(row.orderToken);
    if (!orderToken) {
      orderToken = randomBytes(18).toString("base64url");
      await participant.ref.update({ orderToken, updatedAt: now.toISOString() });
    }
    const at = now.toISOString();
    try {
      await reference.create({
        id: decision.id,
        tenantId,
        projectId: project.id,
        participantId: participant.id,
        type: kind,
        recipient: text(row.email),
        recipientName: text(row.parentName) || null,
        // The parent alone: the job's client is the organiser.
        soleRecipient: true,
        audience: "parent",
        eventDate: decision.eventDate,
        timezone: zone,
        athleteName: text(row.athleteName) || null,
        confirmationCode: text(row.confirmationCode) || null,
        where: eventWhere(data),
        actionUrl: `${appUrl()}/e/order/${orderToken}`,
        status: "queued",
        attempts: 0,
        maxAttempts: 5,
        createdAt: at,
        updatedAt: at,
        createdBy: ACTOR,
      });
      count(beforeDue ? "group_queued" : "group_balance_queued");
    } catch (caught) {
      // Another run got there first: that one is the reminder.
      if ((caught as { code?: unknown }).code === 6) {
        count("group_already");
        continue;
      }
      throw caught;
    }
  }
}

/** At send time (operations/jobs.ts): hold, or the values as they stand now. */
export async function participantReminderPlanFor(db: Firestore, job: DocumentSnapshot): Promise<ParticipantReminderPlan> {
  const tenantId = text(job.get("tenantId"));
  const [project, participant, tenant] = await Promise.all([
    db.doc(`projects/${text(job.get("projectId"))}`).get(),
    db.doc(`eventParticipants/${text(job.get("participantId"))}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  const own = (snapshot: DocumentSnapshot) => (snapshot.exists && snapshot.get("tenantId") === tenantId ? ((snapshot.data() ?? null) as Row | null) : null);
  return participantReminderPlan({
    job: job.data() ?? {},
    project: own(project),
    participant: own(participant),
    studioName: text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Your studio",
    now: new Date(),
  });
}

/** At send time (operations/jobs.ts): the balance nudge — hold if paid since, or what's owed now. */
export async function participantBalancePlanFor(db: Firestore, job: DocumentSnapshot): Promise<ParticipantReminderPlan> {
  const tenantId = text(job.get("tenantId"));
  const [project, participant, tenant] = await Promise.all([
    db.doc(`projects/${text(job.get("projectId"))}`).get(),
    db.doc(`eventParticipants/${text(job.get("participantId"))}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  const own = (snapshot: DocumentSnapshot) => (snapshot.exists && snapshot.get("tenantId") === tenantId ? ((snapshot.data() ?? null) as Row | null) : null);
  return participantBalancePlan({
    job: job.data() ?? {},
    project: own(project),
    participant: own(participant),
    studioName: text(tenant.get("brandName")) || text(tenant.get("businessName")) || "Your studio",
  });
}
