/**
 * The order a photographer expects to read their jobs in.
 *
 * The list used to arrive in Firestore document order, which is effectively
 * alphabetical by key — so a wedding four days away sat third behind one
 * three hundred days out, purely because "bianchi" sorts before "castillo".
 * A list read top-down is read as a priority order whether or not it is one.
 *
 * The rule: what is coming leads, soonest first. What has already happened
 * follows, most recent first, because that is the post-production queue and
 * the freshest wedding is the one being edited. Undated jobs sit last — they
 * are real work, but nothing about them is due.
 *
 * Pure comparator, no I/O.
 */

/**
 * Anything carrying an event date. Deliberately a plain record rather than
 * `{ eventDate?: unknown }`, which TypeScript treats as a weak type and
 * refuses to match against the wide document shapes the UI actually holds.
 */
export type JobOrderRecord = Record<string, unknown>;

const dayValue = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Sort comparator for the studio's job list. `now` is injected so the
 * upcoming/past boundary is testable rather than tied to the clock.
 */
export function compareJobsForList(
  left: JobOrderRecord,
  right: JobOrderRecord,
  now: Date = new Date(),
): number {
  const boundary = now.valueOf();
  const a = dayValue(left.eventDate);
  const b = dayValue(right.eventDate);

  // Undated jobs always sink.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  const aUpcoming = a >= boundary;
  const bUpcoming = b >= boundary;
  if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;

  // Upcoming: soonest first. Past: most recent first.
  return aUpcoming ? a - b : b - a;
}

/** Convenience wrapper — returns a new array, never mutates the input. */
export function orderJobsForList<T extends JobOrderRecord>(
  jobs: readonly T[],
  now: Date = new Date(),
): T[] {
  return [...jobs].sort((left, right) => compareJobsForList(left, right, now));
}
