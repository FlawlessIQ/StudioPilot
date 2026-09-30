/**
 * When a job's date can no longer be edited in place.
 *
 * Found in the money audit (wave 1, 2026-09-30): "Edit job" moved the date of
 * a signed booking with no questions asked, and only the date moved. The
 * signed contract, the crew's calendar invites, the questionnaire's due date
 * and the day the final bill is raised all kept the old one. A booking change
 * (contracts/amendments.ts, applied by booking/amendment-apply.ts) moves every
 * one of them, and the couple signs it — so once they have signed, that is
 * the way to move the date.
 *
 * Before signing, the date is still the studio's to correct, with one
 * exception: an agreement already out for signature states it, so it is
 * withdrawn first and the next one carries the new date.
 *
 * Pure. Duplicated at functions/src/crm/event-date-lock.ts, which cannot
 * import from features/; tests/wave1-money.test.ts fails on a drift.
 */

export type EventDateLock = "signed" | "agreement_out" | null;

/** Signed, or past it: the date is part of the couple's agreement. */
const SIGNED_STATES = [
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
];

/** An agreement with the couple, not yet signed. */
const OUT_FOR_SIGNATURE = ["queued", "sent", "delivered", "viewed", "partially_signed"];

export function eventDateLock(input: {
  state: unknown;
  postponedFromState?: unknown;
  bookingCompletedAt?: unknown;
  contractStatuses: readonly unknown[];
}): EventDateLock {
  const state = String(input.state ?? "");
  const statuses = input.contractStatuses.map(String);
  const signed = statuses.includes("completed");
  // A job on hold is judged by where it was held from.
  const from =
    state === "POSTPONED"
      ? String(input.postponedFromState ?? "") ||
        (typeof input.bookingCompletedAt === "string" && input.bookingCompletedAt ? "BOOKED" : "")
      : state;
  if (SIGNED_STATES.includes(from)) return "signed";
  if (state === "POSTPONED" && signed) return "signed";
  if (from === "CONTRACT_PENDING" && statuses.some((status) => OUT_FOR_SIGNATURE.includes(status)))
    return "agreement_out";
  return null;
}
