/**
 * Group events on Today: one row per event worth a look — happening today,
 * coming up in the next two weeks, or recently over with money still owed
 * or a parent's QuickBooks invoice that failed (docs/group-event-signup-plan-2026-10-10.md).
 *
 * A roster lived only on its job page, so on the morning of a cheer day
 * nothing on Today said there was one, how many had signed up, or what was
 * still to take. Pure: the component reads each event's roster live and
 * hands it here.
 */

import { activeProjectStates } from "@/features/dashboard/active-states";
import {
  normaliseEventSignup,
  participantInvoiceSummary,
  signupState,
  type SignupState,
} from "@/features/group-events/signup";
import { rosterEnabled, rosterSummary, type Participant } from "@/features/group-events/participants";

/** How far either side of today an event is looked at. */
export const GROUP_EVENT_WINDOW_DAYS = 14;
/** Rosters Today reads at most: each is its own live read. */
export const GROUP_EVENT_TODAY_LIMIT = 6;

type ProjectLike = Record<string, unknown> & { id: string };

export type GroupEventCandidate = {
  id: string;
  name: string;
  eventDate: string;
  /** Days from today: 0 is today, negative is past. */
  dayOffset: number;
  groupEvent: unknown;
};

const DAY_MS = 86_400_000;
const dateOnly = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T12:00:00Z`) / DAY_MS);

/**
 * Roster events near today, in the order they matter: today first, then the
 * soonest ahead, then the most recent behind. Archived, cancelled or closed
 * jobs are left out.
 */
export function groupEventsForToday(
  projects: readonly ProjectLike[],
  todayIso: string,
  windowDays = GROUP_EVENT_WINDOW_DAYS,
): GroupEventCandidate[] {
  const today = dayNumber(todayIso);
  const candidates = projects.flatMap((project): GroupEventCandidate[] => {
    if (!rosterEnabled({ groupEvent: project.groupEvent })) return [];
    if (project.archivedAt) return [];
    const state = typeof project.state === "string" ? project.state : "";
    if (state && !activeProjectStates.has(state)) return [];
    const eventDate = dateOnly(project.eventDate);
    if (!eventDate) return [];
    const dayOffset = dayNumber(eventDate) - today;
    if (Math.abs(dayOffset) > windowDays) return [];
    const name = typeof project.name === "string" && project.name.trim() ? project.name.trim() : "Group event";
    return [{ id: project.id, name, eventDate, dayOffset, groupEvent: project.groupEvent }];
  });
  const rank = (candidate: GroupEventCandidate) =>
    candidate.dayOffset === 0 ? 0 : candidate.dayOffset > 0 ? candidate.dayOffset : windowDays - candidate.dayOffset;
  return candidates.sort((left, right) => rank(left) - rank(right)).slice(0, GROUP_EVENT_TODAY_LIMIT);
}

export type GroupEventDay = {
  signedUp: number;
  paid: number;
  owing: number;
  collectedCents: number;
  outstandingCents: number;
  /** Payments recorded today (the reader's day). */
  takenTodayCents: number;
  /** Parents whose QuickBooks invoice QuickBooks refused. */
  failedInvoices: number;
  signup: SignupState;
};

/** One event's roster as Today shows it. */
export function groupEventDay(
  participants: readonly Participant[],
  groupEvent: unknown,
  input: { now: string; isToday: (iso: string) => boolean },
): GroupEventDay {
  const summary = rosterSummary(participants);
  let takenTodayCents = 0;
  let failedInvoices = 0;
  for (const participant of participants) {
    if (participant.status === "paid" && participant.payment && input.isToday(participant.payment.paidAt))
      takenTodayCents += participant.payment.amountCents;
    if (participant.status !== "cancelled" && participant.status !== "paid" && participant.qbInvoice?.state === "failed")
      failedInvoices += 1;
  }
  return {
    signedUp: summary.total,
    paid: summary.paid,
    owing: summary.unpaid + summary.payOnDay,
    collectedCents: summary.collectedCents,
    outstandingCents: summary.outstandingCents,
    takenTodayCents,
    failedInvoices,
    signup: signupState(normaliseEventSignup(groupEvent), input.now, summary.total),
  };
}

/** Upcoming and today's events always show; a past one only while something is left to do. */
export function groupEventShown(candidate: GroupEventCandidate, day: GroupEventDay): boolean {
  if (candidate.dayOffset >= 0) return true;
  return day.outstandingCents > 0 || day.failedInvoices > 0;
}

/** "Today", "Tomorrow", "Sat, Oct 18", or "Sat, Oct 4 · 6 days ago". */
export function groupEventWhen(candidate: Pick<GroupEventCandidate, "eventDate" | "dayOffset">): string {
  if (candidate.dayOffset === 0) return "Today";
  if (candidate.dayOffset === 1) return "Tomorrow";
  const day = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${candidate.eventDate}T12:00:00Z`),
  );
  if (candidate.dayOffset > 0) return day;
  const ago = -candidate.dayOffset;
  return `${day} · ${ago === 1 ? "yesterday" : `${ago} days ago`}`;
}

/** Whether the parents' invoice line has anything worth saying on Today. */
export function failedInvoiceLine(day: GroupEventDay): string | null {
  if (!day.failedInvoices) return null;
  return day.failedInvoices === 1
    ? participantInvoiceSummary({ state: "failed" })
    : `${day.failedInvoices} QuickBooks invoices failed`;
}
