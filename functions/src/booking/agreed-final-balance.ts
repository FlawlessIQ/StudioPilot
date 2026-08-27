/**
 * The balance the couple actually agreed to, and the amount a studio may
 * attest was paid another way.
 *
 * The same reasoning as features/booking/agreed-retainer.ts: the accepted
 * proposal's payment schedule is the agreement, and the package snapshot is
 * only the fallback for a project with no accepted proposal. A studio that
 * moved the split between the two payments must not have StudioCue record a
 * balance nobody agreed to.
 *
 * This exists because the retainer had an escape hatch and the balance did
 * not. `recordRetainerPayment` lets a studio say "they paid me by transfer";
 * the final balance could only ever be settled by a QuickBooks invoice that
 * the scheduler does not create until 28 days before the event. So a wedding
 * whose couple settled up early — or in cash, or by cheque — reached the last
 * closeout requirement, "Final QuickBooks balance settled", with no control
 * anywhere in the product that could satisfy it, and the job could never be
 * closed. The walk of 2026-08-27 ended on exactly that wall.
 *
 * The functions copy. features/booking/agreed-final-balance.ts is the source
 * of truth; functions/ is a separate package with no "@/features" path, so the
 * rule is duplicated here. `tests/final-balance-attestation.test.ts` compares
 * the two and fails on a drift.
 */

/** The label the proposal composer writes for the closing payment. */
const FINAL_LABELS = ["Final balance", "Balance", "Final payment"];

export function finalBalanceFromSchedule(
  schedule: unknown,
  fallbackCents: number,
): number {
  if (!Array.isArray(schedule)) return fallbackCents;
  const entry = schedule.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      FINAL_LABELS.includes(String((candidate as { label?: unknown }).label)),
  );
  const agreed = Number((entry as { amountCents?: unknown })?.amountCents);
  // Zero is a real choice — a couple who paid in full up front owes nothing —
  // so only a missing or nonsensical figure falls back.
  return Number.isInteger(agreed) && agreed >= 0 ? agreed : fallbackCents;
}

/**
 * The fallback: everything agreed, less what the retainer already collected.
 *
 * Never negative. A retainer larger than the total is a data problem, not a
 * refund, and this is not the place to invent one.
 */
export function balanceFromTotals(
  totalCents: number,
  retainerPaidCents: number,
): number {
  if (!Number.isInteger(totalCents) || totalCents < 0) return 0;
  const paid = Number.isInteger(retainerPaidCents) ? retainerPaidCents : 0;
  return Math.max(0, totalCents - paid);
}

/**
 * States in which attesting the balance is meaningful.
 *
 * From the booking onward — a couple can settle up at any point after the job
 * is real — but never on a job that was cancelled or archived, where recording
 * money would be recording it against nothing.
 */
export const BALANCE_ATTESTABLE_STATES: readonly string[] = [
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
];

export function balanceMayBeAttested(state: string): boolean {
  return BALANCE_ATTESTABLE_STATES.includes(state);
}
