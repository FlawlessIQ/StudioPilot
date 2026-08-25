/**
 * The retainer the couple actually agreed to, which is not always the
 * package's.
 *
 * The proposal composer lets a studio override the retainer. That override
 * deliberately leaves the package snapshot alone — the snapshot is the
 * price the couple accepted and immutable records are not rewritten — and
 * moves the split between the two payments instead. But every path that
 * raised a retainer read `retainerCents` straight off the snapshot, so a
 * studio that set a $1 retainer on a $1,899 package had StudioCue bill the
 * client $569.70: a number nobody had agreed to, on an invoice going out in
 * the studio's name.
 *
 * The accepted proposal's payment schedule is the agreement. The snapshot
 * is the fallback, and only for a project with no accepted proposal to
 * consult.
 *
 * Duplicated at functions/src/booking/agreed-retainer.ts, which cannot
 * import from features/. `tests/booking-gate.test.ts` fails on a drift.
 */
export function retainerFromSchedule(
  schedule: unknown,
  fallbackCents: number,
): number {
  if (!Array.isArray(schedule)) return fallbackCents;
  const retainer = schedule.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      String((entry as { label?: unknown }).label) === "Retainer",
  );
  const agreed = Number((retainer as { amountCents?: unknown })?.amountCents);
  // A zero retainer is a real choice — some studios take nothing up front —
  // so only a missing or nonsensical figure falls back to the package.
  return Number.isInteger(agreed) && agreed >= 0 ? agreed : fallbackCents;
}
