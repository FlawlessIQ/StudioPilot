/**
 * When a proposal's validity window should actually start.
 *
 * The draft form defaults `expiresAt` to seven days from the moment it is
 * opened. Production, 2026-08-26: a proposal drafted on Aug 20 for an **October
 * 2027** wedding was still a draft, never sent, and expiring on Aug 28 — two days
 * away. A draft that sits for a week is ordinary; a proposal that expires before
 * the client has ever seen it is not.
 *
 * A validity window means "this offer stands for N days from when you receive
 * it", so the clock starts at send. This re-anchors it, and never shortens a
 * window the studio deliberately set longer.
 *
 * Pure, no I/O.
 */

import { isoToWallClock, validZone, wallClockToIso } from "@/features/schedules/day-clock";

/** The shortest window a client should get once a proposal is sent. */
export const MINIMUM_DAYS_AFTER_SEND = 7;

/**
 * When an event's day ends. Null for no usable date.
 *
 * Without a zone, in UTC, as the composer stores a chosen date
 * (`${day}T23:59:59.000Z`): a draft's default, shown in a date field, reads
 * as the event's own date.
 *
 * With one (the job's zone, else the studio's), on that clock. A send's
 * floor ends there: ended in UTC, a quote reading "Valid through Oct 12"
 * closed at 7:59 PM in New York, and a client saying yes that evening, still
 * Oct 12 where they were, was refused as expired (review of the same-day
 * walk, 2026-10-12).
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

/**
 * A default expiry, no later than the end of the event's day.
 *
 * An offer has nothing left to stand for once the event has happened: a hair
 * quote drafted on Oct 12 for a job on Oct 12 defaulted to "Valid through Oct
 * 19, 2026" (Priya Shah Sangeet, Jess Styles Bridal, 2026-10-12). An event
 * already behind `now`, or a job with no date, leaves the default as it is.
 * `timeZone` ends the day on that clock (eventDayEnd); a draft's default
 * leaves it out.
 */
export function capExpiryAtEvent(expiresAt: Date, eventDate: unknown, now: Date, timeZone?: unknown): Date {
  const end = eventDayEnd(eventDate, timeZone);
  if (!end || end.valueOf() <= now.valueOf() || end.valueOf() >= expiresAt.valueOf()) return expiresAt;
  return end;
}

/**
 * The expiry date a new offer starts with, YYYY-MM-DD: `days` from today, or
 * the event's own date when that comes sooner. Never before today.
 *
 * The chosen day is stored as its end in UTC (`${day}T23:59:59.000Z`), and
 * the server refuses an expiry already past. On an evening in the Americas
 * that moment has gone while the studio's own date is still the event's, so
 * with `now` given, an event day whose end is behind it is no cap — the
 * default stands, as capExpiryAtEvent leaves it at send.
 */
export function defaultExpiryDay(input: { today: string; eventDate: unknown; days?: number; now?: Date }): string {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(input.today) ? input.today : new Date().toISOString().slice(0, 10);
  const later = new Date(`${today}T12:00:00Z`);
  later.setUTCDate(later.getUTCDate() + (input.days ?? MINIMUM_DAYS_AFTER_SEND));
  const fallback = later.toISOString().slice(0, 10);
  const end = eventDayEnd(input.eventDate);
  if (!end || (input.now && end.valueOf() <= input.now.valueOf())) return fallback;
  const eventDay = end.toISOString().slice(0, 10);
  return eventDay >= today && eventDay < fallback ? eventDay : fallback;
}

/**
 * The expiry to store when a proposal is sent.
 *
 * Returns the later of the studio's chosen expiry and
 * `MINIMUM_DAYS_AFTER_SEND` days from the send time — so an intentionally long
 * window survives, and a stale draft's window restarts. That floor stops at
 * the end of the event's day when the event comes sooner (capExpiryAtEvent),
 * on the event's clock: the job's zone, else the studio's.
 */
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

/** Whether a stored expiry would have to be moved for this send to be sane. */
export function expiryNeedsReanchoring(
  chosenExpiresAt: unknown,
  sentAt: Date,
  minimumDays: number = MINIMUM_DAYS_AFTER_SEND,
  eventDate: unknown = null,
  timeZone: unknown = null,
): boolean {
  return (
    expiryOnSend(chosenExpiresAt, sentAt, minimumDays, eventDate, timeZone) !==
    (typeof chosenExpiresAt === "string" ? new Date(chosenExpiresAt).toISOString() : "")
  );
}

/**
 * The last day an offer stands, YYYY-MM-DD: the day "open until" names.
 *
 * A date the studio chose is stored as its end in UTC and is that day. Any
 * other instant, such as a send's floor that runs to the event's own
 * midnight, is read on `timeZone`'s clock (the job's zone, else the
 * studio's; the reader's own without one). Sliced, it named the day after
 * the offer closed: one ending at midnight in New York on Oct 16 is
 * 2026-10-17T03:59:59.000Z. Null for no usable expiry.
 */
export function offerLastDay(expiresAt: unknown, timeZone?: unknown): string | null {
  const instant = typeof expiresAt === "string" && expiresAt.trim() ? new Date(expiresAt) : null;
  if (!instant || Number.isNaN(instant.valueOf())) return null;
  const iso = instant.toISOString();
  if (iso.endsWith("T23:59:59.000Z")) return iso.slice(0, 10);
  const zone = validZone(timeZone) ?? validZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? "UTC";
  return isoToWallClock(iso, zone)?.date ?? iso.slice(0, 10);
}
