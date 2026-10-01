/**
 * The order of a run of show is its clock.
 *
 * GR Productions (2026-10-01): "AI building out of order. And can't move them
 * around." The AI draft was sorted once on the server, and after that the
 * editor rendered the items in array order — retiming a row left it where it
 * was, "Add an item" appended to the bottom, and publishing kept whatever order
 * the array happened to be in. The couple's portal sorted by start, so the
 * studio and the couple could be looking at two different days.
 *
 * One rule now, everywhere: items are listed by start time. Moving an item is
 * therefore not a separate "manual order" that the sort could undo — it moves
 * the item's *time*:
 *
 * - Two items at different times swap their slots. The one moved up takes the
 *   earlier start; the other follows it after the same gap that separated
 *   them. Each keeps its own length, so the pair still covers the same stretch
 *   of the day.
 * - Two items at the same start time just swap places. The sort is stable, so
 *   among equal times the list keeps the order the studio chose.
 *
 * Mirrored at functions/src/planning/item-order.ts, which cannot import from
 * features/. tests/run-of-show-order.test.ts fails on drift.
 *
 * Pure, no I/O.
 */

export type TimedScheduleItem = { startAt: string; endAt: string };

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

/** Whether the row at `index` (in start order) can move up or down. */
export function scheduleItemMoves(
  length: number,
  index: number,
): { up: boolean; down: boolean } {
  return { up: index > 0 && index < length, down: index >= 0 && index < length - 1 };
}

/**
 * Move one item a place up or down the day, by changing times.
 *
 * `index` is the item's place in start order. Returns the whole list, in start
 * order. Out of range is a no-op (the sorted list comes back unchanged).
 */
export function moveScheduleItem<T extends TimedScheduleItem>(
  items: readonly T[],
  index: number,
  direction: "up" | "down",
): T[] {
  const sorted = sortScheduleItems(items);
  const other = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= sorted.length || other < 0 || other >= sorted.length) {
    return sorted;
  }
  const earlierIndex = Math.min(index, other);
  const laterIndex = Math.max(index, other);
  const earlier = sorted[earlierIndex] as T;
  const later = sorted[laterIndex] as T;

  const earlierStart = instant(earlier.startAt);
  const laterStart = instant(later.startAt);
  const next = sorted.slice();

  if (earlierStart === null || laterStart === null || earlierStart === laterStart) {
    // Same time (or no time to trade): only their places change.
    next[earlierIndex] = later;
    next[laterIndex] = earlier;
    return next;
  }

  const length = (item: T, start: number) => {
    const end = instant(item.endAt);
    return end !== null && end > start ? end - start : 0;
  };
  const earlierLength = length(earlier, earlierStart);
  const laterLength = length(later, laterStart);
  const earlierEnd = earlierStart + earlierLength;
  // An overlap is not a gap to carry over.
  const gap = Math.max(0, laterStart - earlierEnd);

  const movedUpStart = earlierStart;
  const movedUpEnd = movedUpStart + laterLength;
  const movedDownStart = movedUpEnd + gap;
  const movedDownEnd = movedDownStart + earlierLength;

  next[earlierIndex] = {
    ...later,
    startAt: new Date(movedUpStart).toISOString(),
    endAt: new Date(movedUpEnd).toISOString(),
  };
  next[laterIndex] = {
    ...earlier,
    startAt: new Date(movedDownStart).toISOString(),
    endAt: new Date(movedDownEnd).toISOString(),
  };
  // Usually already in order; a long item swapped past an overlapping
  // neighbour can land later still, and the clock wins.
  return sortScheduleItems(next);
}
