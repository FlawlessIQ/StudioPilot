import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  CREW_REMINDER_DAYS_BEFORE,
  CREW_REMINDER_EMAIL,
  EVENT_REMINDER_DAYS_BEFORE,
  EVENT_REMINDER_EMAIL,
  addCalendarDays,
  coupleReminderDecision,
  crewReminderDecision,
  crewReminderPlan,
  crewReminderValues,
  eventReminderHold,
  resolveEventZone,
  type CrewReminderPlan,
} from "./event-reminders-core.js";

/**
 * The week-of note to the couple and the call-time reminder to each accepted
 * crew member — the Firestore half. The rules are in event-reminders-core.ts.
 *
 * Fully automatic, like the review and album reminders and the final-details
 * request, and unlike the lifecycle drafts (lifecycle-scheduler.ts) that wait
 * on "Review each time". Those drafts carry words StudioCue wrote — a balance,
 * a checklist — that a person should read first. These carry nothing to
 * check: the couple's is a fixed note and a link to their own timeline; the
 * crew member's is the call time and place from the offer they accepted, and
 * a link to their day sheet. A studio rewords either in the email template
 * studio, as it would any other.
 *
 * Hourly, so "9 AM on the due day" is 9 AM in each wedding's own zone. Each
 * email's id is its idempotency key (event-reminders-core.ts), so a rerun, a
 * retry or a second scheduler instance sends nothing twice.
 */

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com").replace(/\/$/, "");
const ACTOR = "event-reminder-scheduler";

/** The couple's timeline, if one is published with anything on it for them. */
async function coupleScheduleUrl(db: Firestore, tenantId: string, projectId: string): Promise<string | null> {
  const published = await db
    .collection("schedules")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .where("status", "==", "published")
    .limit(1)
    .get();
  const items = published.docs[0]?.get("items");
  const forThem = Array.isArray(items) && items.some((item) => ["client", "shared"].includes(text((item as Row)?.visibility)));
  // A link to "No times are set yet" is not the link this email exists for;
  // without one the portal's Home is.
  return forThem ? `${appUrl()}/client/schedule` : null;
}

/** Somebody to send it to: the first client contact, with an address. */
async function coupleHasEmail(db: Firestore, tenantId: string, project: Row): Promise<boolean> {
  const ids = Array.isArray(project.clientContactIds) ? project.clientContactIds : [];
  const contactId = typeof ids[0] === "string" ? ids[0] : "";
  if (!contactId) return false;
  const contact = await db.doc(`contacts/${contactId}`).get();
  return contact.exists && contact.get("tenantId") === tenantId && text(contact.get("email")).includes("@");
}

async function remindCouple(db: Firestore, project: DocumentSnapshot, zone: string, now: Date): Promise<string> {
  const data = project.data() ?? {};
  const tenantId = text(data.tenantId);
  const decision = coupleReminderDecision({ tenantId, projectId: project.id, project: data, now, zone });
  if (!decision.send) return `couple_${decision.reason}`;
  const reference = db.doc(`emailJobs/${decision.id}`);
  if ((await reference.get()).exists) return "couple_already";
  // Checked each run rather than recorded: an address added inside the window
  // still gets its reminder.
  if (!(await coupleHasEmail(db, tenantId, data))) return "couple_no_email";
  const at = now.toISOString();
  try {
    await reference.create({
      id: decision.id,
      tenantId,
      projectId: project.id,
      type: EVENT_REMINDER_EMAIL,
      eventDate: decision.eventDate,
      timezone: decision.zone,
      portalUrl: `${appUrl()}/client`,
      scheduleUrl: await coupleScheduleUrl(db, tenantId, project.id),
      // Read the job again as it sends (operations/jobs.ts): paused, put away,
      // cancelled or on hold is held — and so is a moved date (eventReminderHold).
      clientOutreachGuard: true,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      createdAt: at,
      updatedAt: at,
      createdBy: ACTOR,
    });
  } catch (caught) {
    // Another run got there first: that one is the reminder.
    if ((caught as { code?: unknown }).code === 6) return "couple_already";
    throw caught;
  }
  return "couple_queued";
}

async function remindCrew(db: Firestore, project: DocumentSnapshot, zone: string, now: Date, tally: Record<string, number>) {
  const data = project.data() ?? {};
  const tenantId = text(data.tenantId);
  const assignments = await db
    .collection("crewAssignments")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", project.id)
    .where("status", "==", "accepted")
    .limit(40)
    .get();
  const count = (key: string) => (tally[key] = (tally[key] ?? 0) + 1);
  for (const assignment of assignments.docs) {
    const row = assignment.data();
    const decision = crewReminderDecision({ tenantId, assignmentId: assignment.id, assignment: row, project: data, now, zone });
    if (!decision.send) {
      count(`crew_${decision.reason}`);
      continue;
    }
    const reference = db.doc(`emailJobs/${decision.id}`);
    if ((await reference.get()).exists) {
      count("crew_already");
      continue;
    }
    const profile = await db.doc(`crewProfiles/${text(row.crewProfileId)}`).get();
    const email = profile.exists && profile.get("tenantId") === tenantId ? text(profile.get("email")) : "";
    if (!email.includes("@")) {
      count("crew_no_email");
      continue;
    }
    const at = now.toISOString();
    try {
      await reference.create({
        id: decision.id,
        tenantId,
        projectId: project.id,
        assignmentId: assignment.id,
        type: CREW_REMINDER_EMAIL,
        recipient: email,
        // Always set: left empty, the sender would greet them by the couple's name.
        recipientName: text(profile.get("name")) || text(profile.get("displayName")) || email.split("@")[0],
        ...crewReminderValues(row, data, decision.zone),
        // To this job's day sheet, not whichever job the page picks.
        scheduleUrl: `${appUrl()}/crew/schedule?assignment=${encodeURIComponent(assignment.id)}`,
        status: "queued",
        attempts: 0,
        maxAttempts: 5,
        createdAt: at,
        updatedAt: at,
        createdBy: ACTOR,
      });
      count("crew_queued");
    } catch (caught) {
      if ((caught as { code?: unknown }).code === 6) {
        count("crew_already");
        continue;
      }
      throw caught;
    }
  }
}

/**
 * One sweep at a chosen `now`. The scheduler passes the clock; a script can
 * pass any instant to see what would go then.
 */
export async function sweepEventReminders(db: Firestore, now: Date): Promise<Record<string, number>> {
  // The window, widened by a day each side for zones either side of UTC.
  const first = now.toISOString().slice(0, 10);
  const from = addCalendarDays(first, -1)!;
  const to = addCalendarDays(first, Math.max(EVENT_REMINDER_DAYS_BEFORE, CREW_REMINDER_DAYS_BEFORE + 1) + 1)!;
  const crewUntil = addCalendarDays(first, CREW_REMINDER_DAYS_BEFORE + 2)!;
  const zones = new Map<string, Promise<unknown>>();
  const tally: Record<string, number> = {};
  let last: DocumentSnapshot | null = null;
  for (;;) {
    let query = db.collection("projects").where("eventDate", ">=", from).where("eventDate", "<=", to).orderBy("eventDate").limit(300);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    for (const project of page.docs) {
      const data = project.data();
      const tenantId = text(data.tenantId);
      if (!tenantId) continue;
      try {
        if (!zones.has(tenantId))
          zones.set(tenantId, db.doc(`tenants/${tenantId}`).get().then((tenant) => tenant.get("timezone")));
        // The wedding's own zone, else the studio's.
        const zone = resolveEventZone(data.timezone, await zones.get(tenantId));
        const outcome = await remindCouple(db, project, zone, now);
        tally[outcome] = (tally[outcome] ?? 0) + 1;
        if (text(data.eventDate).slice(0, 10) <= crewUntil) await remindCrew(db, project, zone, now, tally);
      } catch (caught) {
        tally.failed = (tally.failed ?? 0) + 1;
        console.error(
          JSON.stringify({
            severity: "ERROR",
            event: "event_reminder.failed",
            projectId: project.id,
            reason: caught instanceof Error ? caught.message : String(caught),
          }),
        );
      }
    }
    if (page.size < 300) break;
    last = page.docs[page.docs.length - 1] ?? null;
  }
  return tally;
}

export const eventReminderScheduler = onSchedule(
  { schedule: "every 1 hours", timeZone: "UTC", retryCount: 2 },
  async () => {
    const tally = await sweepEventReminders(getFirestore(), new Date());
    console.log(JSON.stringify({ severity: "INFO", event: "event_reminder.swept", ...tally }));
  },
);

/**
 * At send time (operations/jobs.ts): why a queued couple reminder is held, or
 * null to send it.
 */
export async function eventReminderHoldFor(db: Firestore, job: DocumentSnapshot): Promise<string | null> {
  const project = await db.doc(`projects/${text(job.get("projectId"))}`).get();
  return eventReminderHold({ job: job.data() ?? {}, project: project.exists ? (project.data() ?? null) : null, now: new Date() });
}

/**
 * At send time (operations/jobs.ts): hold, or the call time and place as the
 * assignment says them now.
 */
export async function crewReminderPlanFor(db: Firestore, job: DocumentSnapshot): Promise<CrewReminderPlan> {
  const [assignment, project] = await Promise.all([
    db.doc(`crewAssignments/${text(job.get("assignmentId"))}`).get(),
    db.doc(`projects/${text(job.get("projectId"))}`).get(),
  ]);
  return crewReminderPlan({
    job: job.data() ?? {},
    assignment: assignment.exists ? (assignment.data() ?? null) : null,
    project: project.exists ? (project.data() ?? null) : null,
    now: new Date(),
  });
}
