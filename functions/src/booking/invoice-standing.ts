/**
 * The functions copy of the standing-invoice rule.
 *
 * features/booking/invoice-standing.ts is the source of truth; functions/
 * is a separate package with no "@/features" path, so the rule is
 * duplicated here. `tests/booking-gate.test.ts` fails on a drift.
 */
const NOT_STANDING = new Set(["failed", "superseded", "voided"]);

export function isStandingInvoice(status: unknown): boolean {
  return !NOT_STANDING.has(String(status));
}
