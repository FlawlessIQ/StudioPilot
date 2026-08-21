/**
 * Event-date formatting and the temporal awareness the studio surfaces need.
 *
 * Raw ISO strings were rendering straight into the dashboard hero and the
 * projects table ("2026-08-15"), and nothing anywhere noticed when an event
 * date had already passed while its project was still in Planning.
 */

const monthDay = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const monthDayYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const weekdayMonthDay = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** Parses `YYYY-MM-DD` as a local date, so a date never shifts by a timezone. */
export function parseEventDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : startOfDay(parsed);
  }
  const [, y, m, d] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d));
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

/** "Aug 15" this year, "Aug 15, 2027" otherwise. */
export function formatEventDate(value: unknown, now: Date = new Date()): string {
  const date = parseEventDate(value);
  if (!date) return "Date to confirm";
  return date.getFullYear() === now.getFullYear()
    ? monthDay.format(date)
    : monthDayYear.format(date);
}

/**
 * "Sep 3, 2026" — always with the year, never relative to today.
 *
 * Due dates and expiries routinely sit on the far side of a year boundary,
 * and they are read as commitments rather than as "soon". Unlike
 * formatEventDate this never varies with the current year, which also keeps
 * the deterministic engines that emit these strings deterministic.
 */
export function formatDueDate(value: unknown): string {
  const date = parseEventDate(value);
  return date ? monthDayYear.format(date) : "Date to confirm";
}

/** "Saturday, August 15" — for day detail panels and agendas. */
export function formatEventDateLong(value: unknown): string {
  const date = parseEventDate(value);
  return date ? weekdayMonthDay.format(date) : "Date to confirm";
}

/** Whole days from today. Negative means the date has passed. */
export function daysUntilEvent(value: unknown, now: Date = new Date()): number | null {
  const date = parseEventDate(value);
  if (!date) return null;
  return Math.round(
    (date.valueOf() - startOfDay(now).valueOf()) / 86_400_000,
  );
}

/**
 * How soon, in words: "today", "tomorrow", "in 12 days", "3 days ago".
 * Phrasing the photographer would use, not a duration.
 */
export function describeEventProximity(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const days = daysUntilEvent(value, now);
  if (days === null) return null;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  const past = Math.abs(days);
  return `${past} day${past === 1 ? "" : "s"} ago`;
}

/**
 * True when the event has already happened. A project in this state that is
 * not yet complete is an exception the studio must see, not a quiet row —
 * the demo tenant had a wedding three days past while still in Planning and
 * nothing in the UI said so.
 */
export function eventDateHasPassed(value: unknown, now: Date = new Date()): boolean {
  const days = daysUntilEvent(value, now);
  return days !== null && days < 0;
}
