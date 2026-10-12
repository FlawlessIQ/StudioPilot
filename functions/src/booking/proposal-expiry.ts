/**
 * Proposal expiry — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/booking/proposal-expiry.ts. That copy holds the tests and is
 * the source of truth; change both together (tests/twin-small-items.test.ts
 * checks they agree).
 */

import { isoToWallClock, validZone, wallClockToIso } from "../planning/day-clock.js";

export const MINIMUM_DAYS_AFTER_SEND = 7;

/**
 * When an event's day ends: in UTC without a zone, as a chosen date is
 * stored; on that clock with one (see the features copy). Null for no usable date.
 */
function eventDayEnd(eventDate: unknown, timeZone?: unknown): Date | null {
  const day = typeof eventDate === "string" ? eventDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const end = new Date(`${day}T23:59:59.000Z`);
  if (Number.isNaN(end.valueOf())) return null;
  const zone = validZone(timeZone);
  const lastMinute = zone ? wallClockToIso(day, "23:59", zone) : null;
  return lastMinute ? new Date(Date.parse(lastMinute) + 59_000) : end;
}

/** A default expiry, no later than the end of the event's day (see the features copy). */
export function capExpiryAtEvent(expiresAt: Date, eventDate: unknown, now: Date, timeZone?: unknown): Date {
  const end = eventDayEnd(eventDate, timeZone);
  if (!end || end.valueOf() <= now.valueOf() || end.valueOf() >= expiresAt.valueOf()) return expiresAt;
  return end;
}

export function expiryOnSend(
  chosenExpiresAt: unknown,
  sentAt: Date,
  minimumDays: number = MINIMUM_DAYS_AFTER_SEND,
  /** The job's date: the floor never runs past the end of the event's day. */
  eventDate: unknown = null,
  /** The clock that day ends on: day-clock.ts `eventZone(job's zone, studio's)`. */
  timeZone: unknown = null,
): string {
  const floor = capExpiryAtEvent(new Date(sentAt.valueOf() + minimumDays * 86_400_000), eventDate, sentAt, timeZone);
  const chosen =
    typeof chosenExpiresAt === "string" && chosenExpiresAt.trim()
      ? new Date(chosenExpiresAt)
      : null;
  if (!chosen || Number.isNaN(chosen.valueOf())) return floor.toISOString();
  return chosen.valueOf() > floor.valueOf()
    ? chosen.toISOString()
    : floor.toISOString();
}

/** The last day an offer stands, YYYY-MM-DD, on `timeZone`'s clock (see the features copy). */
export function offerLastDay(expiresAt: unknown, timeZone?: unknown): string | null {
  const instant = typeof expiresAt === "string" && expiresAt.trim() ? new Date(expiresAt) : null;
  if (!instant || Number.isNaN(instant.valueOf())) return null;
  const iso = instant.toISOString();
  if (iso.endsWith("T23:59:59.000Z")) return iso.slice(0, 10);
  const zone = validZone(timeZone) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  return isoToWallClock(iso, zone)?.date ?? iso.slice(0, 10);
}
