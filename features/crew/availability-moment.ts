/**
 * Whether a crew member's availability page should be asking for dates.
 *
 * The only window on Jordan's page was two weeks past, labelled "available ·
 * past", and the page said nothing else — on the screen whose entire purpose
 * is making him bookable, in a workspace whose home read "No upcoming jobs
 * right now". A subcontractor with no future availability and no upcoming work
 * is exactly the person the page exists for.
 *
 * Pure predicate, no I/O. Takes the raw `endsAt` strings so the caller does no
 * date work of its own — the same reason `crewCloseoutMoment` takes strings.
 */
export function availabilityNeedsFutureWindows(
  endsAt: readonly string[],
  now: Date,
): boolean {
  const cutoff = now.valueOf();
  for (const value of endsAt) {
    const at = Date.parse(value);
    // An unreadable end is not evidence of a future window.
    if (Number.isFinite(at) && at > cutoff) return false;
  }
  return true;
}
