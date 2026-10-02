import { clientOutreachStop } from "../post-event/client-outreach.js";

/**
 * The two reminders before the day: the couple's week-of note
 * (`event_reminder`) and each accepted crew member's call-time reminder
 * (`crew_reminder`).
 *
 * Both templates existed and nothing queued them (docs/communications.md). The
 * couple heard nothing between the thirty-day drafts and the day-before
 * checklist; a second shooter booked months ago had the offer email and
 * nothing since, so their call time and the run of show lived only in an app
 * they had no reason to open.
 *
 * Every date here is the event's own calendar date, read in the event's own
 * zone. A UTC "today" sends a Los Angeles couple's reminder at 5 PM the day
 * before it is due, and a crew member's call date read in UTC can be the day
 * after the one they are working.
 *
 * Pure: `now` is always passed in, so a test or a script can ask "what would
 * go out at 9 AM on the 3rd?" (event-reminders.ts is the Firestore half).
 */

/** The couple's note goes a week before the wedding… */
export const EVENT_REMINDER_DAYS_BEFORE = 7;
/**
 * …and no later than two days before. Closer than that the day-before
 * checklist (lifecycle `day_before_checklist`) is the note, and "your day is
 * coming up" the morning before reads as an afterthought.
 */
export const EVENT_REMINDER_LAST_DAYS_BEFORE = 2;
/** Crew hear two days before their call: time to plan the drive and the kit. */
export const CREW_REMINDER_DAYS_BEFORE = 2;
/** On the first due day, nothing goes before 9 AM in the event's zone. */
export const REMINDER_SEND_HOUR = 9;
/** Booked and still ahead. `EVENT_IN_PROGRESS` is the day itself: too late. */
export const REMINDER_STATES: readonly string[] = ["BOOKED", "PLANNING", "READY"];

export const EVENT_REMINDER_EMAIL = "event_reminder";
export const CREW_REMINDER_EMAIL = "crew_reminder";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const DAY_MS = 86_400_000;

function validZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The first real IANA zone of those given — the job's, the project's, the studio's — else UTC. */
export function resolveEventZone(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const zone = text(candidate);
    if (zone && validZone(zone)) return zone;
  }
  return "UTC";
}

function zonedParts(instant: Date, zone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: validZone(zone) ? zone : "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

/** YYYY-MM-DD as a clock in `zone` reads at `instant`. */
export function zonedCalendarDate(instant: Date, zone: string): string {
  const parts = zonedParts(instant, zone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** 0–23 as a clock in `zone` reads at `instant`. */
export function zonedHour(instant: Date, zone: string): number {
  return Number(zonedParts(instant, zone).hour) % 24;
}

/** A calendar date moved by whole days, or null if it isn't a date. */
export function addCalendarDays(date: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  const moved = new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
  return moved;
}

const eventDateOf = (project: Row): string | null => {
  const date = text(project.eventDate).slice(0, 10);
  return addCalendarDays(date, 0) ? date : null;
};

/**
 * Whether `today` (in the event's zone) has reached `dueOn`, honouring the
 * 9 AM floor on the first day. A later day — the scheduler catching up, or a
 * booking made inside the window — goes at once.
 */
function reached(dueOn: string, now: Date, zone: string): boolean {
  const today = zonedCalendarDate(now, zone);
  if (today < dueOn) return false;
  if (today === dueOn && zonedHour(now, zone) < REMINDER_SEND_HOUR) return false;
  return true;
}

/**
 * One reminder per job per wedding date. The date is in the key so a wedding
 * that moves gets its reminder for the new date — and only one, however many
 * times the scheduler runs.
 */
export const eventReminderJobId = (tenantId: string, projectId: string, eventDate: string) =>
  `${EVENT_REMINDER_EMAIL}_${tenantId}_${projectId}_${eventDate}`;

/** One reminder per assignment per call date, for the same reason. */
export const crewReminderJobId = (tenantId: string, assignmentId: string, callDate: string) =>
  `${CREW_REMINDER_EMAIL}_${tenantId}_${assignmentId}_${callDate}`;

export type ReminderSkip =
  | "no_date"
  | "not_booked"
  | "not_yet"
  | "too_late"
  | "past"
  | "not_accepted"
  | "put_away"
  | "automations_paused"
  | "cancelled"
  | "on_hold";

export type CoupleReminderDecision =
  | { send: true; id: string; eventDate: string; zone: string }
  | { send: false; reason: ReminderSkip };

/**
 * Pure: whether the couple's week-of reminder goes now.
 *
 * Never for a quiet job. `clientOutreachStop` covers archived, cancelled,
 * lost, postponed — and `clientAutomationsPausedAt`, which every imported
 * booking carries until the studio brings the couple in (ADR 0005).
 */
export function coupleReminderDecision(input: {
  tenantId: string;
  projectId: string;
  project: Row;
  now: Date;
  /** The event's zone: the project's, else the studio's (resolveEventZone). */
  zone: string;
}): CoupleReminderDecision {
  const { project, now, zone } = input;
  const stop = clientOutreachStop(project);
  if (stop) return { send: false, reason: stop };
  if (!REMINDER_STATES.includes(text(project.state))) return { send: false, reason: "not_booked" };
  const eventDate = eventDateOf(project);
  if (!input.tenantId || !eventDate) return { send: false, reason: "no_date" };
  const opens = addCalendarDays(eventDate, -EVENT_REMINDER_DAYS_BEFORE)!;
  const closes = addCalendarDays(eventDate, -EVENT_REMINDER_LAST_DAYS_BEFORE)!;
  if (!reached(opens, now, zone)) return { send: false, reason: "not_yet" };
  if (zonedCalendarDate(now, zone) > closes) return { send: false, reason: "too_late" };
  return { send: true, id: eventReminderJobId(input.tenantId, input.projectId, eventDate), eventDate, zone };
}

/**
 * When and where this person is due, from their assignment — the offer they
 * accepted — falling back to the job's date and venue for anything it lacks.
 */
export function crewCall(assignment: Row, project: Row, zone: string): {
  /** The call time as an instant, when the assignment has one. */
  arrivalAt: string | null;
  departureAt: string | null;
  /** The calendar date they are due, in the event's zone. */
  callDate: string | null;
  locationName: string | null;
  locationAddress: string | null;
} {
  const arrival = text(assignment.arrivalAt);
  const arrivalAt = arrival && Number.isFinite(Date.parse(arrival)) ? new Date(arrival).toISOString() : null;
  const departure = text(assignment.departureAt);
  const departureAt = departure && Number.isFinite(Date.parse(departure)) ? new Date(departure).toISOString() : null;
  const callDate = arrivalAt ? zonedCalendarDate(new Date(arrivalAt), zone) : eventDateOf(project);
  const first = record(Array.isArray(assignment.locations) ? assignment.locations[0] : null);
  const locationName = text(first.name) || text(project.venueName) || null;
  const locationAddress = text(first.name) ? text(first.address) || null : text(project.venueAddress) || null;
  return { arrivalAt, departureAt, callDate, locationName, locationAddress };
}

export type CrewReminderDecision =
  | { send: true; id: string; callDate: string; zone: string }
  | { send: false; reason: ReminderSkip };

/**
 * Pure: whether this crew member's reminder goes now.
 *
 * Accepted assignments only — an offer still open, declined, withdrawn or
 * cancelled is not somebody we expect on the day. A job put away, called off
 * or on hold reminds nobody. A *quiet* job still reminds its crew: quiet is
 * about the couple (ADR 0005), and a crew member who accepted through
 * StudioCue is already hearing from it.
 */
export function crewReminderDecision(input: {
  tenantId: string;
  assignmentId: string;
  assignment: Row;
  project: Row;
  now: Date;
  zone: string;
}): CrewReminderDecision {
  const { assignment, project, now, zone } = input;
  if (text(assignment.status) !== "accepted" || assignment.archivedAt) return { send: false, reason: "not_accepted" };
  const stop = clientOutreachStop(project);
  if (stop && stop !== "automations_paused") return { send: false, reason: stop };
  if (!REMINDER_STATES.includes(text(project.state))) return { send: false, reason: "not_booked" };
  const call = crewCall(assignment, project, zone);
  if (!input.tenantId || !call.callDate) return { send: false, reason: "no_date" };
  // After the call time there is nothing to remind them of; with no time on
  // the assignment, the day itself is too late.
  if (call.arrivalAt ? now.valueOf() >= Date.parse(call.arrivalAt) : zonedCalendarDate(now, zone) >= call.callDate)
    return { send: false, reason: "past" };
  const opens = addCalendarDays(call.callDate, -CREW_REMINDER_DAYS_BEFORE)!;
  if (!reached(opens, now, zone)) return { send: false, reason: "not_yet" };
  return { send: true, id: crewReminderJobId(input.tenantId, input.assignmentId, call.callDate), callDate: call.callDate, zone };
}

/**
 * Pure, at send time: why a queued couple reminder must not go now, or null.
 *
 * The job is read again as it sends — the scheduler's view is minutes old at
 * best and a retry's can be hours. A wedding cancelled, postponed, put away or
 * paused in between is held (the sender's `clientOutreachGuard` does that
 * too); so is one whose date moved — its reminder is the new date's — and one
 * whose day has come.
 */
export function eventReminderHold(input: { job: Row; project: Row | null; now: Date }): string | null {
  const { job, project, now } = input;
  if (!project || text(project.tenantId) !== text(job.tenantId)) return "job_missing";
  const stop = clientOutreachStop(project);
  if (stop) return stop;
  if (!REMINDER_STATES.includes(text(project.state))) return "not_booked";
  const eventDate = eventDateOf(project);
  if (!eventDate || eventDate !== text(job.eventDate)) return "date_changed";
  if (zonedCalendarDate(now, resolveEventZone(job.timezone, project.timezone)) >= eventDate) return "event_passed";
  return null;
}

export type CrewReminderPlan =
  | { hold: string }
  | { values: Record<string, unknown> };

/**
 * Pure, at send time: hold, or the values to render.
 *
 * The call time and place are read from the assignment as it is now, not as
 * it was when the reminder was queued, so a call moved an hour earlier says
 * the new time. One moved to another day is held: that day's reminder is its
 * own (crewReminderJobId).
 */
export function crewReminderPlan(input: {
  job: Row;
  assignment: Row | null;
  project: Row | null;
  now: Date;
}): CrewReminderPlan {
  const { job, assignment, project, now } = input;
  if (!assignment || text(assignment.tenantId) !== text(job.tenantId)) return { hold: "assignment_missing" };
  if (!project || text(project.tenantId) !== text(job.tenantId)) return { hold: "job_missing" };
  const zone = resolveEventZone(job.timezone, project.timezone);
  const decision = crewReminderDecision({
    tenantId: text(job.tenantId),
    assignmentId: text(job.assignmentId),
    assignment,
    project,
    now,
    zone,
  });
  // "Not yet" is fine here — the job was due when it was queued. Every other
  // reason is the world having changed since.
  if (!decision.send && decision.reason !== "not_yet") return { hold: decision.reason };
  const call = crewCall(assignment, project, zone);
  if (call.callDate !== text(job.callDate)) return { hold: "call_date_changed" };
  return { values: crewReminderValues(assignment, project, zone) };
}

/** What the crew reminder says: role, call time, where, and whether the run of show is out. */
export function crewReminderValues(assignment: Row, project: Row, zone: string): Record<string, unknown> {
  const call = crewCall(assignment, project, zone);
  return {
    role: text(assignment.role) || null,
    arrivalAt: call.arrivalAt,
    departureAt: call.departureAt,
    callDate: call.callDate,
    locationName: call.locationName,
    locationAddress: call.locationAddress,
    // The day sheet says "the studio hasn't shared the run of show" until a
    // schedule is published to this assignment; the email says the same.
    runOfShowShared: Boolean(text(assignment.currentScheduleId)),
    timezone: zone,
  };
}
