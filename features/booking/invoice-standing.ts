/**
 * Is this invoice record still standing?
 *
 * A retainer can end up in several states that are emphatically not "a
 * retainer the client owes": refused by the accounting provider, or
 * replaced by a later attempt. Every place that asks "does a retainer
 * already exist" has to agree about which of those count, and for a while
 * they did not — the gate, the orchestrator, the attestation and the
 * create command each carried their own list, and the create command's
 * list was missing "superseded". So a studio whose first attempt had been
 * replaced was told a retainer already existed, by the very command whose
 * job was to replace it, with no way forward.
 *
 * One predicate, so there is nothing left to keep in step by hand.
 *
 * Duplicated at functions/src/booking/invoice-standing.ts, which cannot
 * import from features/. `tests/booking-gate.test.ts` fails on a drift.
 */
const NOT_STANDING = new Set(["failed", "superseded", "voided"]);

export function isStandingInvoice(status: unknown): boolean {
  return !NOT_STANDING.has(String(status));
}
