/**
 * Availability in days, the way a second shooter thinks about it.
 *
 * The form asked for a start and end to the minute, so "free the weekends of
 * the 9th and the 24th" became "Sep 9, 2026 at 2:29 PM to Sep 24, 2026 at
 * 2:29 PM" — the time being whenever the picker happened to open. Crew are
 * free on days, and occasionally only part of one. So a window is a first and
 * last day, inclusive, with times only when someone says so.
 *
 * Storage is unchanged: an instant range, `endsAt` exclusive, because the
 * ranking engine compares windows against a job's arrival and departure. A
 * whole-day window is simply local midnight to the midnight after the last
 * day, and is recognised as one when it is read back.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/** YYYY-MM-DD of an instant in the browser's own calendar. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local midnight at the start of a YYYY-MM-DD, or null if it isn't a real day. */
function startOfDay(day: string): Date | null {
  const match = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDay(date) === day ? date : null;
}

function atTime(day: string, time: string): Date | null {
  const date = startOfDay(day);
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!date || !match) return null;
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

export type AvailabilityDays = {
  firstDay: string;
  lastDay: string;
  /** Both null for whole days. */
  startTime: string | null;
  endTime: string | null;
};

/**
 * The instants to store for a range of days. Whole days run from midnight on
 * the first to midnight after the last, so a single Saturday is 24 hours, not
 * the zero-length window a same-day start and end would otherwise make.
 */
export function windowFromDays(
  days: AvailabilityDays,
): { startsAt: Date; endsAt: Date } | { problem: string } {
  const first = startOfDay(days.firstDay);
  const last = startOfDay(days.lastDay);
  if (!first) return { problem: "Choose the first day you're free." };
  if (!last) return { problem: "Choose the last day you're free." };
  if (last < first) return { problem: "The last day can't be before the first." };
  if (days.startTime === null || days.endTime === null) {
    const endsAt = new Date(last);
    endsAt.setDate(endsAt.getDate() + 1);
    return { startsAt: first, endsAt };
  }
  const startsAt = atTime(days.firstDay, days.startTime);
  const endsAt = atTime(days.lastDay, days.endTime);
  if (!startsAt || !endsAt) return { problem: "Choose a start and end time." };
  if (endsAt <= startsAt) return { problem: "Choose an end time after the start time." };
  return { startsAt, endsAt };
}

/** A stored window read back as days, recognising whole-day ones. */
export function daysFromWindow(startsAt: string, endsAt: string): AvailabilityDays | null {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) return null;
  const wholeDays =
    localTime(start) === "00:00" && localTime(end) === "00:00" && end > start;
  if (wholeDays) {
    const last = new Date(end);
    last.setDate(last.getDate() - 1);
    return { firstDay: localDay(start), lastDay: localDay(last), startTime: null, endTime: null };
  }
  return {
    firstDay: localDay(start),
    lastDay: localDay(end),
    startTime: localTime(start),
    endTime: localTime(end),
  };
}

/** "Sat, Sep 12", "Sep 9 – Sep 24", or "Sat, Sep 12, 2 PM – 11 PM". */
export function describeAvailability(startsAt: string, endsAt: string): string {
  const days = daysFromWindow(startsAt, endsAt);
  if (!days) return "";
  const first = startOfDay(days.firstDay)!;
  const last = startOfDay(days.lastDay)!;
  const sameYear = first.getFullYear() === new Date().getFullYear() && last.getFullYear() === first.getFullYear();
  const dayLabel = (date: Date, weekday: boolean) =>
    date.toLocaleDateString("en-US", {
      ...(weekday ? { weekday: "short" as const } : {}),
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" as const }),
    });
  const single = days.firstDay === days.lastDay;
  if (days.startTime === null) {
    return single ? dayLabel(first, true) : `${dayLabel(first, false)} – ${dayLabel(last, false)}`;
  }
  const time = (day: string, value: string) =>
    atTime(day, value)!.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "");
  return single
    ? `${dayLabel(first, true)}, ${time(days.firstDay, days.startTime)} – ${time(days.lastDay, days.endTime!)}`
    : `${dayLabel(first, false)} ${time(days.firstDay, days.startTime)} – ${dayLabel(last, false)} ${time(days.lastDay, days.endTime!)}`;
}
