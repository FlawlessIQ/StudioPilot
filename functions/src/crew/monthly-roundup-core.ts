import { clientOutreachStop } from "../post-event/client-outreach.js";
import {
  REMINDER_SEND_HOUR,
  REMINDER_STATES,
  crewCall,
  zonedCalendarDate,
  zonedHour,
} from "../communications/event-reminders-core.js";

/**
 * Each crew member's monthly list of the jobs they've accepted — the pure half.
 *
 * GR, 2026-10-07. Albert: "Once accepted they should be getting a reminder
 * every few months." Gabe: "Can we send out reminders for all jobs booked
 * monthly?" A wedding is accepted up to a year ahead, and the only note a
 * crew member got before this was the call-time reminder two days out. One
 * email a month, per crew member per studio, listing every job still ahead —
 * not one email per job, which on a busy calendar would be a dozen.
 *
 * Sent in the first days of the month, from 9 AM in the studio's zone. The
 * days after the first are catch-up for a missed run, not a second send: the
 * id is per month, so it goes once. Someone who accepts their first job on
 * the 15th waits for the next month's — they have just said yes to it.
 */

export const CREW_ROUNDUP_EMAIL = "crew_monthly_roundup";
/** The days of the month on which this month's list may go (catch-up included). */
export const ROUNDUP_LAST_DAY = 3;
/** The most jobs listed by name; the rest are counted. */
export const ROUNDUP_MAX_LISTED = 20;

type Row = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** One accepted job on the list, as the email says it. */
export type RoundupEntry = {
  assignmentId: string;
  projectId: string;
  /** The day they are due, YYYY-MM-DD in the event's zone. */
  date: string;
  jobName: string;
  role: string | null;
  /** The call time as an instant, when the assignment has one. */
  arrivalAt: string | null;
  locationName: string | null;
  timezone: string;
};

/** Whether the studio sends it. On unless switched off in Settings → Crew offers. */
export function roundupEnabled(tenant: Row | null | undefined): boolean {
  const offers = tenant?.crewOffers;
  const setting =
    typeof offers === "object" && offers !== null ? (offers as Row).monthlyRoundup : undefined;
  return setting !== false;
}

/** This month's key ("2026-11") when the list is due now in this zone, else null. */
export function roundupMonthDue(now: Date, zone: string): string | null {
  const today = zonedCalendarDate(now, zone);
  const day = Number(today.slice(8, 10));
  if (!Number.isFinite(day) || day > ROUNDUP_LAST_DAY) return null;
  if (day === 1 && zonedHour(now, zone) < REMINDER_SEND_HOUR) return null;
  return today.slice(0, 7);
}

/** One list per crew member per studio per month, however often the sweep runs. */
export const roundupJobId = (tenantId: string, crewProfileId: string, month: string) =>
  `${CREW_ROUNDUP_EMAIL}_${tenantId}_${crewProfileId}_${month}`;

/**
 * The job, as it belongs on the list, or null.
 *
 * The same jobs the call-time reminder would remind them of: accepted, on a
 * booked job that is still going ahead, and still ahead of them. A quiet
 * (imported) job still lists — quiet is about the couple (ADR 0005), and
 * this crew member said yes to it.
 */
export function roundupEntry(input: {
  assignmentId: string;
  assignment: Row;
  project: Row | null;
  tenantId: string;
  zone: string;
  now: Date;
}): RoundupEntry | null {
  const { assignment, project, tenantId, zone, now } = input;
  if (text(assignment.status) !== "accepted" || assignment.archivedAt) return null;
  if (!project || text(project.tenantId) !== tenantId) return null;
  const stop = clientOutreachStop(project);
  if (stop && stop !== "automations_paused") return null;
  if (!REMINDER_STATES.includes(text(project.state))) return null;
  const call = crewCall(assignment, project, zone);
  if (!call.callDate || call.callDate < zonedCalendarDate(now, zone)) return null;
  return {
    assignmentId: input.assignmentId,
    projectId: text(assignment.projectId),
    date: call.callDate,
    jobName: text(project.name) || "Your job",
    role: text(assignment.role) || null,
    arrivalAt: call.arrivalAt,
    locationName: call.locationName,
    timezone: zone,
  };
}

/** Soonest first; a second role on the same day stays beside the first. */
export function orderRoundup(entries: readonly RoundupEntry[]): RoundupEntry[] {
  return [...entries].sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      (left.arrivalAt ?? "").localeCompare(right.arrivalAt ?? "") ||
      left.jobName.localeCompare(right.jobName),
  );
}
