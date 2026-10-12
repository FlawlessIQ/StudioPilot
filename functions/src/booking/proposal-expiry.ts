/**
 * Proposal expiry — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/booking/proposal-expiry.ts. That copy holds the tests and is
 * the source of truth; change both together (tests/twin-small-items.test.ts
 * checks they agree).
 */

export const MINIMUM_DAYS_AFTER_SEND = 7;

/** When an event's day ends, as an offer's expiry is written. Null for no usable date. */
function eventDayEnd(eventDate: unknown): Date | null {
  const day = typeof eventDate === "string" ? eventDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const end = new Date(`${day}T23:59:59.000Z`);
  return Number.isNaN(end.valueOf()) ? null : end;
}

/** A default expiry, no later than the end of the event's day (see the features copy). */
export function capExpiryAtEvent(expiresAt: Date, eventDate: unknown, now: Date): Date {
  const end = eventDayEnd(eventDate);
  if (!end || end.valueOf() <= now.valueOf() || end.valueOf() >= expiresAt.valueOf()) return expiresAt;
  return end;
}

export function expiryOnSend(
  chosenExpiresAt: unknown,
  sentAt: Date,
  minimumDays: number = MINIMUM_DAYS_AFTER_SEND,
  /** The job's date: the floor never runs past the end of the event's day. */
  eventDate: unknown = null,
): string {
  const floor = capExpiryAtEvent(new Date(sentAt.valueOf() + minimumDays * 86_400_000), eventDate, sentAt);
  const chosen =
    typeof chosenExpiresAt === "string" && chosenExpiresAt.trim()
      ? new Date(chosenExpiresAt)
      : null;
  if (!chosen || Number.isNaN(chosen.valueOf())) return floor.toISOString();
  return chosen.valueOf() > floor.valueOf()
    ? chosen.toISOString()
    : floor.toISOString();
}
