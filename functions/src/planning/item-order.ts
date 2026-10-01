/**
 * A run of show is stored in start order — the functions copy.
 *
 * features/schedules/run-of-show-order.ts is the source of truth and explains
 * why (GR Productions, 2026-10-01: the studio's editor and the couple's portal
 * could show the same version in two different orders). functions/ is a
 * separate package with no "@/features" path. tests/run-of-show-order.test.ts
 * compares the two and fails on drift.
 */

const instant = (value: unknown): number | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Earlier start first. An item with no usable start goes last. Equal starts
 * compare as equal, so a stable sort keeps their existing order.
 */
export function compareScheduleItemsByStart(
  left: { startAt?: unknown },
  right: { startAt?: unknown },
): number {
  const a = instant(left.startAt);
  const b = instant(right.startAt);
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** A copy in start order. Stable: items at the same time keep their order. */
export function sortScheduleItems<T extends { startAt?: unknown }>(
  items: readonly T[],
): T[] {
  return items.slice().sort(compareScheduleItemsByStart);
}
