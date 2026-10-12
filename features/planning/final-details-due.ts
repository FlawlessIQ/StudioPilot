/**
 * Whether a job's final details go out to the client now: the sign-off and
 * its final details call for most studios, the one-tap headcount for a
 * client priced per person (makeup, hair).
 *
 * One rule for every reader. The daily sweep
 * (functions/src/planning/final-details.ts), the two moments that open it
 * without waiting for the sweep — the job booking inside its lock window, and
 * a per-person client's party list coming back — and the journey that says
 * where it stands. The journey read the date alone, so a lead dated inside
 * the window said "Meanwhile, waiting on the client: Final headcount" with
 * nothing sent, and nothing would be until they booked (Priya Shah's sangeet,
 * Jess Styles Bridal, 2026-10-12).
 *
 * Whether the job has a lock at all (job-kinds.ts `finalDetailsLockApplies`)
 * and whether a sign-off is already open are the caller's to check first.
 *
 * Pure, with no imports: copied byte for byte to
 * functions/src/planning/final-details-due.ts, and
 * tests/final-details-lock-window.test.ts fails on drift.
 */

/** Booked: the states the sign-off is opened in. */
export const FINAL_DETAILS_STATES: readonly string[] = ["BOOKED", "PLANNING", "READY"];

export type FinalDetailsDue =
  /** Open it now. */
  | "due"
  /** The lock is still ahead, or the job has no date to lock from. */
  | "before_lock"
  /** The day has been. */
  | "event_passed"
  /** The studio has said not to write to them (post-event/client-outreach.ts). */
  | "quiet"
  /** Not booked yet: it goes out when they book. */
  | "not_booked";

/**
 * Today, on the job's own calendar: the date a clock in the event's zone
 * reads, else the studio's, else UTC (the first real zone given, as
 * communications/event-reminders-core.ts `resolveEventZone` picks it).
 *
 * Every reader of `finalDetailsDue` asks with this, so the server and the
 * screens agree on the lock day and the day itself. The server read the UTC
 * date and the job page the viewer's: a US studio booking a same-day job in
 * the evening was told "asked within the day" by the page while the server,
 * already on tomorrow's date, called the day gone and sent nothing.
 */
export function finalDetailsToday(now: Date | string, ...zones: unknown[]): string {
  const instant = typeof now === "string" ? new Date(now) : now;
  for (const zone of zones) {
    if (typeof zone !== "string" || !zone.trim()) continue;
    try {
      const parts: Record<string, string> = {};
      for (const part of new Intl.DateTimeFormat("en-US", { timeZone: zone.trim(), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant))
        parts[part.type] = part.value;
      if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      // Not a zone: the next one, as resolveEventZone does.
    }
  }
  return instant.toISOString().slice(0, 10);
}

export function finalDetailsDue(input: {
  /** The job's state. */
  state: unknown;
  /** Whether `clientOutreachStop(project)` stops it: archived, paused, cancelled or on hold. */
  quiet: boolean;
  /** YYYY-MM-DD */
  eventDate: unknown;
  /** The day the details lock (planning-timeline.ts `detailsLockOn`). */
  lockOn: string | null;
  /** YYYY-MM-DD */
  today: string;
}): FinalDetailsDue {
  const eventDate = String(input.eventDate ?? "").slice(0, 10);
  if (!input.lockOn || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || input.today < input.lockOn) return "before_lock";
  if (eventDate < input.today) return "event_passed";
  if (input.quiet) return "quiet";
  if (!FINAL_DETAILS_STATES.includes(String(input.state ?? ""))) return "not_booked";
  return "due";
}
