/**
 * The stages at which a signed booking can be changed (a booking amendment).
 *
 * From the moment the couple signs until the wedding: before that, packages
 * and the date are simply edited; after it, there is nothing left to change.
 * Mirrors AMENDABLE_STATES in functions/src/booking/amendment-core.ts, which
 * the server enforces; tests/booking-amendment.test.ts fails on a drift.
 */
export const AMENDABLE_STATES = ["RETAINER_PENDING", "BOOKED", "PLANNING", "READY", "POSTPONED"];

export function isAmendable(state: unknown): boolean {
  return AMENDABLE_STATES.includes(String(state ?? ""));
}
