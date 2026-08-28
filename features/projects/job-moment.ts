/**
 * Where a job is in its life, for anything that surfaces work about it.
 *
 * Three systems put work in front of a studio — the journey, AI-prepared
 * actions and tasks — and each read only its own record. So a delivery note
 * waited for approval on a job that was closed, an overdue task demanded the
 * second shooter be booked for a wedding that had been cancelled, and a
 * certificate-of-insurance task sat in the overdue list thirteen days after the
 * wedding it insured.
 *
 * One predicate, consulted by all of them.
 *
 * The distinction that matters is between a job that is **over** and a job
 * whose **event has passed**. They are not the same, and they call for
 * opposite treatment:
 *
 *   - Over (closed, cancelled, archived): stop surfacing work. There is nothing
 *     left to do and nobody to do it for.
 *   - Event passed but still live: keep surfacing everything, and ask the
 *     question that resolves it — *did this happen?* Hiding the work here would
 *     be a guess. If the wedding was postponed rather than shot, that COI
 *     wording still matters.
 */

import type { ProjectState } from "@/features/projects/schema";

/** Nothing more will be done on this job. */
const OVER: readonly string[] = ["CLOSED", "CANCELLED", "ARCHIVED"];

/** The job has not reached its event yet, as far as its state is concerned. */
const BEFORE_THE_EVENT: readonly string[] = [
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
];

export function jobIsOver(state: string): boolean {
  return OVER.includes(state);
}

export function jobIsOnHold(state: string): boolean {
  return state === "POSTPONED";
}

/** Days from today to the event; negative once it is behind them. */
export function daysToEvent(
  eventDate: string | null | undefined,
  today: string,
): number | null {
  if (!eventDate) return null;
  const event = Date.parse(`${eventDate}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(event) || !Number.isFinite(now)) return null;
  return Math.round((event - now) / 86_400_000);
}

/**
 * A job whose date has gone by while its state never moved past preparation.
 *
 * Three of eleven demo jobs were in this state — Planning or Ready with the
 * event six to twenty days behind them — and nothing anywhere said so. The
 * journey offered delivery, which skips the only question worth asking.
 */
export function awaitingEventReconciliation(input: {
  state: string;
  eventDate: string | null | undefined;
  today: string;
}): boolean {
  if (!BEFORE_THE_EVENT.includes(input.state)) return false;
  // A lead or an unbooked enquiry with an old date is a stale enquiry, not an
  // unrecorded wedding. Reconciliation starts once the job is real.
  if (!["BOOKED", "PLANNING", "READY"].includes(input.state)) return false;
  const days = daysToEvent(input.eventDate, input.today);
  return days !== null && days < 0;
}

/**
 * Whether a studio should still be shown work about this job.
 *
 * Used by Today for AI drafts and tasks alike. Deliberately narrow: only a job
 * that is genuinely finished is silenced.
 */
export function workStillMatters(state: string): boolean {
  return !jobIsOver(state);
}

/** The states a job can be reconciled into once its date has passed. */
export const RECONCILE_TARGETS: readonly ProjectState[] = [
  "EVENT_COMPLETE",
  "POSTPONED",
  "CANCELLED",
];
