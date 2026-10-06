/**
 * Wall-clock times on the event's day, in the event's own timezone.
 *
 * A wedding happens in one place, so "the ceremony is at 4:00" means 4:00
 * there, whatever zone the studio's laptop or the server is in. The schedule
 * screen read and wrote times in the browser's zone, and the AI draft read a
 * time with no offset ("2027-08-17T17:00") as UTC — GR Productions' first look
 * at 5:00 PM showed at 1:00 PM in New Jersey (2026-10-05). Every conversion
 * between "4:00 on the day" and a stored instant goes through here.
 *
 * Pure, no imports. Mirrored at functions/src/planning/day-clock.ts; the test
 * fails on drift.
 */

export const DEFAULT_EVENT_ZONE = "America/New_York";

/** A timezone Intl knows, or null. */
export function validZone(zone: unknown): string | null {
  if (typeof zone !== "string" || !zone.trim()) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone.trim() });
    return zone.trim();
  } catch {
    return null;
  }
}

/** The first valid zone of the candidates (job, then studio), else New York. */
export function eventZone(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const zone = validZone(candidate);
    if (zone) return zone;
  }
  return DEFAULT_EVENT_ZONE;
}

/** Minutes ahead of UTC that `timeZone` observes at `instant` (DST-aware). */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(instant);
  const raw = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+00:00";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
  if (!match) return 0;
  return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
}

/** "4:30 PM", "4pm", "16:30" → "16:30"; anything else → null. */
export function clockOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^\s*(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(a\.?m\.?|p\.?m\.?)?\s*$/i.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, "");
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "pm" && hours !== 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  } else if (!match[2]) {
    return null;
  }
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Minutes since midnight of an "HH:MM" clock. */
export function clockMinutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

/** "HH:MM" for minutes since midnight; null outside the day. */
export function minutesClock(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 24 * 60) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The UTC instant for "HH:MM" on `date` (YYYY-MM-DD) in `timeZone`. Two passes settle DST. */
export function wallClockToIso(date: string, clock: string, timeZone: string): string | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const time = clockOf(clock);
  if (!day || !time) return null;
  const guess = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 0, clockMinutes(time)));
  const offset = offsetMinutesAt(guess, timeZone);
  const resolved = new Date(guess.getTime() - offset * 60_000);
  const second = offsetMinutesAt(resolved, timeZone);
  return (second === offset ? resolved : new Date(guess.getTime() - second * 60_000)).toISOString();
}

/** The day and "HH:MM" an instant reads as in `timeZone`. */
export function isoToWallClock(iso: string, timeZone: string): { date: string; clock: string } | null {
  const instant = new Date(iso);
  if (!Number.isFinite(instant.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, clock: `${get("hour")}:${get("minute")}` };
}

/**
 * An ISO timestamp as a UTC instant. One with an offset or "Z" is taken as
 * written; one without ("2027-08-17T17:00") is a wall clock in `timeZone`.
 */
export function naiveToIso(value: string, timeZone: string): string | null {
  const naive = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (naive) return wallClockToIso(naive[1]!, naive[2]!, timeZone);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/** "4:30 PM" for an "HH:MM" clock. */
export function spokenClock(clock: string): string {
  const minutes = clockMinutes(clock);
  const hours = Math.floor(minutes / 60);
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes % 60).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
}
