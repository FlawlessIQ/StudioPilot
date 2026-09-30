/**
 * Where a job on hold may go back to.
 *
 * The functions copy. features/projects/hold-resume.ts is the source of truth;
 * functions/ is a separate package with no "@/features" path, so the rule is
 * duplicated and tests/wave0-money.test.ts asserts the two files stay
 * byte-identical below their headers.
 *
 * Pure.
 */
const HELD_BEFORE_BOOKING = ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING"];
const HELD_AFTER_BOOKING = ["BOOKED", "PLANNING", "READY"];

export type HoldRecord = {
  postponedFromState?: unknown;
  bookingCompletedAt?: unknown;
};

/**
 * Whether a held job had been booked when it went on hold.
 *
 * `postponedFromState` says so directly. A job held before that field was
 * recorded falls back to `bookingCompletedAt`, which the booking gate and the
 * orchestrator both stamp.
 */
export function heldAfterBooking(hold: HoldRecord): boolean {
  const from = String(hold.postponedFromState ?? "");
  if (HELD_AFTER_BOOKING.includes(from)) return true;
  if (HELD_BEFORE_BOOKING.includes(from)) return false;
  return typeof hold.bookingCompletedAt === "string" && hold.bookingCompletedAt.length > 0;
}

/**
 * The ungated moves out of POSTPONED this hold allows.
 *
 * POSTPONED → PLANNING was not gated, so a job at PROPOSAL could be put on
 * hold and brought straight back into PLANNING: unsigned, unpaid, booked in
 * all but name — and Cue offered it (money audit, 2026-09-30). A hold now
 * returns a job to where it was. A booked job comes back to PLANNING (or
 * through the booking gate to BOOKED, which is evidence-controlled and so
 * never listed here); an unbooked one comes back to the stage it left. A hold
 * recorded before `postponedFromState` existed, on a job never booked, keeps
 * the one backward move it always had.
 */
export function holdResumeStates(hold: HoldRecord): string[] {
  const from = String(hold.postponedFromState ?? "");
  if (heldAfterBooking(hold)) return ["PLANNING", "CANCELLED"];
  if (HELD_BEFORE_BOOKING.includes(from)) return [from, "CANCELLED"];
  return ["CONSULTATION", "CANCELLED"];
}
