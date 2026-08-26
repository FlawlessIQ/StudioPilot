/**
 * Ordering work by how long it has been waiting.
 *
 * Four lists in the audit of 2026-08-26 sorted against the work they exist to
 * serve, all by ordering on a date descending:
 *
 *   /studio/leads      newest inquiry first, so the 5-day-old one was last
 *   /crew/jobs         finished jobs interleaved with upcoming
 *   /crew/closeout     defaulted to a wedding 3 days away over one 27 days past
 *   /studio/delivery   alphabetical, with the deliverable job 8th of 9
 *
 * The thing that needs doing is always the oldest. A studio's most perishable
 * asset is an unanswered inquiry, and putting it at the bottom of the list is
 * how it goes cold.
 *
 * Pure, no I/O. Deliberately does not import from `lib/` so it stays
 * framework-neutral like the rest of `features/`.
 */

function timestamp(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf()) ? null : value.valueOf();
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  // A bare YYYY-MM-DD is anchored at midday so a timezone cannot shunt it
  // across a day boundary and change which item looks older.
  const source = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? `${value.trim()}T12:00:00Z`
    : value;
  const parsed = new Date(source);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.valueOf();
}

/**
 * Whole days between `since` and `now`, or null when `since` is unusable.
 * Never negative for a past date — callers asking "how long has this waited"
 * want a magnitude.
 */
export function waitingDays(since: unknown, now: Date = new Date()): number | null {
  const start = timestamp(since);
  if (start === null) return null;
  const elapsed = now.valueOf() - start;
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

/**
 * Comparator putting the longest-waiting item first.
 *
 * Items with no usable date sort **last**: an item that cannot be aged should
 * not displace one that provably has been waiting.
 */
export function byLongestWaiting<T>(
  dateOf: (item: T) => unknown,
): (left: T, right: T) => number {
  return (left, right) => {
    const a = timestamp(dateOf(left));
    const b = timestamp(dateOf(right));
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b; // oldest first
  };
}

/** "waiting 5 days" / "waiting since today" — the phrase, ready to render. */
export function waitingLabel(since: unknown, now: Date = new Date()): string | null {
  const days = waitingDays(since, now);
  if (days === null) return null;
  if (days === 0) return "arrived today";
  return `waiting ${days} day${days === 1 ? "" : "s"}`;
}
