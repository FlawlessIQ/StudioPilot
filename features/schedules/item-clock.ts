/**
 * Reading the clock off a schedule item, safely.
 *
 * The client portal rendered `new Date(String(item.startAt)).toLocaleTimeString()`
 * directly. When `startAt` is absent that produces the literal string
 * **"Invalid Date"**, and the couple's event-day brief showed it six times on a
 * schedule headed "VERSION 2 · APPROVED", three days before the wedding.
 *
 * An item with no usable time is not a time to display badly — it is an item
 * that cannot be shown. Callers get `null` and are expected to leave it out, and
 * to say something honest when nothing is left, rather than rendering a row of
 * broken clocks.
 *
 * Pure, no I/O.
 */

export type ScheduleItemClock = {
  /** Formatted start, e.g. "1:00 PM". */
  start: string;
  /** Formatted end, or null when the item has no valid end. */
  end: string | null;
};

function parse(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function formatTime(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/**
 * The displayable clock for one schedule item, or null when it has no valid
 * start. An invalid *end* alone does not disqualify an item — a start time is
 * the minimum a client needs to be somewhere.
 */
export function scheduleItemClock(
  item: Record<string, unknown>,
  timeZone?: string,
): ScheduleItemClock | null {
  const start = parse(item.startAt);
  if (!start) return null;
  const end = parse(item.endAt);
  let zone = timeZone;
  if (zone) {
    // An unknown IANA zone makes Intl throw, which would take the page down for
    // a formatting concern. Fall back to the runtime's zone instead.
    try {
      formatTime(start, zone);
    } catch {
      zone = undefined;
    }
  }
  return { start: formatTime(start, zone), end: end ? formatTime(end, zone) : null };
}

/** The items a client can actually be shown, in start order. */
export function displayableScheduleItems<T extends Record<string, unknown>>(
  items: readonly T[],
): T[] {
  return items
    .filter((item) => scheduleItemClock(item) !== null)
    .slice()
    .sort((left, right) =>
      String(left.startAt).localeCompare(String(right.startAt)),
    );
}
