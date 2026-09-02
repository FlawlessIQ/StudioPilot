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

/**
 * Today's date as `YYYY-MM-DD`, in the reader's own timezone.
 *
 * `new Date().toISOString().slice(0, 10)` is the obvious way to write this and
 * it is wrong west of Greenwich: after 8pm Eastern it returns tomorrow. Passed
 * as "today" into the journey engine, that shifted every countdown in the
 * product by a day each evening while the page header — formatted locally —
 * went on printing the right date. Today read "Thursday, August 27" above
 * "September 4 · in 7 days", which is eight.
 */
/**
 * Today's date as `YYYY-MM-DD`, as observed in a named timezone.
 *
 * `todayLocalIso` is right in the browser, where "local" is the reader. It is
 * wrong on a server, where local is whatever the container is set to — UTC on
 * Cloud Run — so an overdue-invoice comparison made there marked a US couple's
 * balance late a day early every evening.
 *
 * `en-CA` is not decoration: it is the locale whose numeric format is already
 * `YYYY-MM-DD`, so this needs no part juggling.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  if (!timeZone) return todayLocalIso(now);
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    // An unknown zone must not take the page down with it.
    return todayLocalIso(now);
  }
}

export function todayLocalIso(now: Date = new Date()): string {
  const local = startOfDay(now);
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${local.getFullYear()}-${month}-${day}`;
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
 * How soon, in words: "today", "tomorrow", "in 12 days", "in 14 months".
 * Phrasing the photographer would use, not a duration.
 *
 * Past about two months a day count stops being a unit anyone thinks in.
 * A 2027 wedding was reading "in 414 days" — technically true, and no
 * photographer has ever said it. Couples book 12–18 months out, so long
 * horizons are the normal case here, not an edge one.
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
  if (days > 0) return `in ${countdownPhrase(days)}`;
  return `${countdownPhrase(Math.abs(days))} ago`;
}

/**
 * "9 days" / "3 months" / "2 years" — the span alone, so callers can put
 * their own preposition on it.
 */
export function countdownPhrase(days: number): string {
  if (days <= 60) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = days / 365;
  // "in 1 year" is a worse answer than "in 13 months" for anything that is
  // not close to a round year.
  if (years < 1.75) {
    const months = Math.round(days / 30.44);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const rounded = Math.round(years);
  return `${rounded} year${rounded === 1 ? "" : "s"}`;
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
