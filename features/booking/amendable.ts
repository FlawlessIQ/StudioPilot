/**
 * The stages at which a signed booking can be changed (a booking amendment).
 *
 * From the moment the couple signs until the wedding: before that, packages
 * and the date are simply edited; after it, there is nothing left to change.
 * Mirrors AMENDABLE_STATES in functions/src/booking/amendment-core.ts, which
 * the server enforces; tests/booking-amendment.test.ts fails on a drift.
 */
export const AMENDABLE_STATES = ["RETAINER_PENDING", "BOOKED", "PLANNING", "READY", "POSTPONED"];

export function isAmendable(state: unknown): boolean {
  return AMENDABLE_STATES.includes(String(state ?? ""));
}


/** Minutes a zone is ahead of UTC at one instant (e.g. -240 for New York in summer). */
function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * Mirrors shiftInZone in functions/src/booking/amendment-core.ts (the server
 * applies it; this previews it); tests/booking-amendment.test.ts compares them.
 *
 * An ISO timestamp moved by whole days, keeping its local clock time in
 * `timeZone` — a 3 PM call stays at 3 PM across a daylight-saving change,
 * where adding 24-hour days would land it at 2 or 4. An unknown zone falls
 * back to whole UTC days.
 */
export function shiftInZone(value: unknown, days: number, timeZone: string | null | undefined): unknown {
  if (typeof value !== "string" || !days) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const moved = ms + days * 86_400_000;
  if (!timeZone) return new Date(moved).toISOString();
  try {
    const delta = zoneOffsetMinutes(ms, timeZone) - zoneOffsetMinutes(moved, timeZone);
    return new Date(moved + delta * 60_000).toISOString();
  } catch {
    return new Date(moved).toISOString();
  }
}
