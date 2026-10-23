/**
 * What a client is told when the studio's booking link has no times to offer
 * because the studio's calendar could not be read.
 *
 * The server fails closed (functions/src/integrations/busy-time.ts
 * `decideCalendarAvailability`): a connected calendar it cannot read might
 * hold any hour, so it offers none rather than let a client book over
 * something the studio already has. "No times are open right now" would be
 * untrue — the studio may have plenty — so the client hears that booking
 * online is paused and how to reach the studio instead.
 *
 * Pure. Read by the consultation invite page and the couple's inquiry page.
 */

/** The flag and code the server answers with (public-scheduling.ts). */
export const BOOKING_PAUSED_CODE = "CALENDAR_AVAILABILITY_UNAVAILABLE";

/** True for an availability answer that offers nothing because of the calendar. */
export function bookingPaused(availability: Record<string, unknown> | null | undefined): boolean {
  return availability?.bookingUnavailable === true;
}

/** "Online booking is briefly unavailable. Please contact Lumen Studio directly…" */
export function bookingPausedCopy(studioName: string | null | undefined): string {
  const studio = studioName?.trim() || "the studio";
  return `Online booking is briefly unavailable. Please contact ${studio} directly — reply to their email and they’ll find a time with you.`;
}
