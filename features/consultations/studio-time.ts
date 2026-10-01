/**
 * Consultation times on the studio's clock.
 *
 * The studio calendar grouped slots into days by the studio's timezone but
 * printed each time with the browser's — so an owner travelling, or an
 * assistant in another state, saw a 2:00 PM slot as 11:00 AM under the right
 * day, and booking or moving one sent the browser's zone to the server as if
 * it were the studio's. Every time on that screen now goes through here, the
 * way components/kit/slot-picker.tsx already did for couples.
 */

function formatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: timeZone || undefined });
  } catch {
    // An unknown zone name should not blank the calendar; fall back to the
    // reader's clock rather than throwing during render.
    return new Intl.DateTimeFormat("en-US", options);
  }
}

/** "2:00 PM" in `timeZone`. Newer ICU puts a narrow no-break space before AM/PM; plain space keeps it as it was. */
export function formatStudioTime(iso: string, timeZone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.valueOf())) return "";
  return formatter(timeZone).format(instant).replace(/[  ]/g, " ");
}

/** "2:00 PM – 2:45 PM" in `timeZone`. */
export function formatStudioTimeRange(startIso: string, endIso: string, timeZone: string): string {
  return `${formatStudioTime(startIso, timeZone)} – ${formatStudioTime(endIso, timeZone)}`;
}
