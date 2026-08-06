import type { ConsultationSettings, Weekday } from "@/features/consultations/availability-schema";

const weekdayOrder: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type BusyInterval = { start: string; end: string };
export type ConsultationSlot = { startsAt: string; endsAt: string };

/**
 * UTC offset (in minutes, positive = ahead of UTC) that `timeZone` observes
 * at `instant`. Node ships full ICU, so Intl.DateTimeFormat's "longOffset"
 * is a real, DST-aware lookup — no timezone-data dependency needed.
 */
function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

/**
 * The UTC instant for a studio-local wall-clock time (year/month/day are
 * 1-indexed month, plain calendar numbers — not a Date already in some
 * other zone). Resolves DST by checking the offset twice: once for the
 * naive guess, once for the guess corrected by that offset — the second
 * lookup only differs from the first on the handful of days per year a
 * DST transition actually falls on.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, minuteOfDay));
  const offset = offsetMinutesAt(guess, timeZone);
  const resolved = new Date(guess.getTime() - offset * 60_000);
  const offset2 = offsetMinutesAt(resolved, timeZone);
  return offset2 === offset ? resolved : new Date(guess.getTime() - offset2 * 60_000);
}

/** {year, month, day, weekday} for "now" as observed in `timeZone`. */
function zonedCalendarDate(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayLabel = get("weekday").toLowerCase().slice(0, 3) as Weekday;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayOrder.includes(weekdayLabel) ? weekdayLabel : "sun",
  };
}

/** Add `days` to a plain (year, month, day) triple via UTC arithmetic — safe because this never touches wall-clock hours, only calendar-date bookkeeping. */
function addCalendarDays(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

type MinuteWindow = { startMinute: number; endMinute: number };

/** Sorted-interval subtraction: `base` minus every overlapping `carve` window, in minute-of-day space. */
function subtractIntervals(base: readonly MinuteWindow[], carve: readonly MinuteWindow[]): MinuteWindow[] {
  let remaining: MinuteWindow[] = base.map((w) => ({ ...w }));
  for (const cut of carve) {
    const next: MinuteWindow[] = [];
    for (const window of remaining) {
      if (cut.endMinute <= window.startMinute || cut.startMinute >= window.endMinute) {
        next.push(window);
        continue;
      }
      if (cut.startMinute > window.startMinute) {
        next.push({ startMinute: window.startMinute, endMinute: Math.min(cut.startMinute, window.endMinute) });
      }
      if (cut.endMinute < window.endMinute) {
        next.push({ startMinute: Math.max(cut.endMinute, window.startMinute), endMinute: window.endMinute });
      }
    }
    remaining = next;
  }
  return remaining;
}

/**
 * Which minute-of-day windows are bookable on `weekday`, given the studio's
 * mode. closed_default: `windowsByDay` IS the bookable set. open_default:
 * `windowsByDay` is the outer envelope and `unavailableByDay` is subtracted
 * from it — a weekday absent from `windowsByDay` is closed regardless of
 * mode, so there is no implicit "always open" fallback.
 */
function resolveDayWindows(
  mode: "closed_default" | "open_default",
  windowsByDay: Map<Weekday, MinuteWindow[]>,
  unavailableByDay: Map<Weekday, MinuteWindow[]>,
  weekday: Weekday,
): MinuteWindow[] {
  const envelope = windowsByDay.get(weekday) ?? [];
  if (mode === "closed_default") return envelope;
  return subtractIntervals(envelope, unavailableByDay.get(weekday) ?? []);
}

/**
 * Deterministic, timezone-correct consultation slot generation. Walks
 * calendar dates as observed in `timezone` (not UTC dates — a studio's
 * "Tuesday 9am" window must land on the Tuesday a client sees on their own
 * calendar, not whatever weekday that instant happens to be in UTC), skips
 * `blockedDates`, and drops any candidate slot that overlaps `busy` once
 * `bufferMinutes` padding is applied on both sides.
 */
export function generateConsultationSlots(input: {
  settings: Pick<ConsultationSettings, "durationMinutes" | "bufferMinutes" | "windows" | "blockedDates"> &
    Partial<Pick<ConsultationSettings, "mode" | "unavailableWindows">>;
  timezone: string;
  now: Date;
  startInDays: number;
  daysAhead: number;
  busy: readonly BusyInterval[];
  maxSlots: number;
}): ConsultationSlot[] {
  const { settings, timezone, now, startInDays, daysAhead, busy, maxSlots } = input;
  const mode = settings.mode ?? "closed_default";
  const busyMs = busy.map((interval) => ({
    start: Date.parse(interval.start),
    end: Date.parse(interval.end),
  }));
  const blocked = new Set(settings.blockedDates);
  const windowsByDay = new Map<Weekday, MinuteWindow[]>();
  for (const window of settings.windows) {
    const list = windowsByDay.get(window.day) ?? [];
    list.push({ startMinute: window.startMinute, endMinute: window.endMinute });
    windowsByDay.set(window.day, list);
  }
  const unavailableByDay = new Map<Weekday, MinuteWindow[]>();
  for (const window of settings.unavailableWindows ?? []) {
    const list = unavailableByDay.get(window.day) ?? [];
    list.push({ startMinute: window.startMinute, endMinute: window.endMinute });
    unavailableByDay.set(window.day, list);
  }

  const today = zonedCalendarDate(now, timezone);
  const rangeStart = addCalendarDays(today.year, today.month, today.day, startInDays);
  const slots: ConsultationSlot[] = [];

  for (let offset = 0; offset < daysAhead && slots.length < maxSlots; offset += 1) {
    const { year, month, day } = addCalendarDays(rangeStart.year, rangeStart.month, rangeStart.day, offset);
    if (blocked.has(isoDate(year, month, day))) continue;
    const weekday = zonedCalendarDate(zonedTimeToUtc(year, month, day, 12 * 60, timezone), timezone).weekday;
    const windows = resolveDayWindows(mode, windowsByDay, unavailableByDay, weekday);
    for (const window of windows) {
      for (
        let minute = window.startMinute;
        minute + settings.durationMinutes <= window.endMinute && slots.length < maxSlots;
        minute += settings.durationMinutes + settings.bufferMinutes
      ) {
        const start = zonedTimeToUtc(year, month, day, minute, timezone);
        const end = new Date(start.getTime() + settings.durationMinutes * 60_000);
        const bufferMs = settings.bufferMinutes * 60_000;
        const overlaps = busyMs.some(
          (interval) => start.getTime() < interval.end + bufferMs && end.getTime() + bufferMs > interval.start,
        );
        if (!overlaps) {
          slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() });
        }
      }
    }
  }

  return slots.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
