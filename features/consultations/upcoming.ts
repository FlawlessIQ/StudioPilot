/**
 * Calls that are booked and still ahead.
 *
 * A couple booked a consultation from their inquiry page and the studio could
 * only find it on the calendar (GR, 2026-10-09): Today drops the inquiry card
 * once the job leaves LEAD, the Inquiries row said "Consult", and the job's
 * step said "Meeting booked" — none of them said when. Every surface that
 * names a booked call reads it from here, on the call's own clock.
 */

import { isSalesConsultation } from "./purpose";

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/**
 * Scheduled calls that have not ended yet, soonest first. A call in progress
 * still counts: the studio may be looking for the join link.
 */
export function upcomingCalls<T extends Row>(consultations: readonly T[], now: Date): T[] {
  const nowMs = now.valueOf();
  return consultations
    .filter((record) => {
      if (record.status !== "scheduled" || record.archivedAt) return false;
      const ends = Date.parse(text(record.endsAt) || text(record.startsAt));
      return Number.isFinite(ends) && ends >= nowMs;
    })
    .sort((left, right) => text(left.startsAt).localeCompare(text(right.startsAt)));
}

/** The job's next booked sales consultation, or null. */
export function nextSalesCall<T extends Row>(consultations: readonly T[], projectId: string, now: Date): T | null {
  return upcomingCalls(
    consultations.filter((record) => record.projectId === projectId && isSalesConsultation(record)),
    now,
  )[0] ?? null;
}

const MODE_WORDS: Record<string, string> = {
  in_person: "in person",
  phone: "by phone",
  zoom: "on Zoom",
  google_meet: "on Google Meet",
};

/** "Sat, Oct 10 at 12:00 PM" on the call's clock (the studio's, when it has none). */
export function callWhen(record: Row, fallbackTimeZone = "America/New_York"): string {
  const instant = new Date(text(record.startsAt));
  if (Number.isNaN(instant.valueOf())) return "";
  const timeZone = text(record.timezone) || fallbackTimeZone;
  const format = (options: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(instant);
    } catch {
      return new Intl.DateTimeFormat("en-US", options).format(instant);
    }
  };
  const day = format({ weekday: "short", month: "short", day: "numeric" });
  // Newer ICU puts a narrow no-break space before AM/PM.
  const time = format({ hour: "numeric", minute: "2-digit" }).replace(/[  ]/g, " ");
  return `${day} at ${time}`;
}

/** "Sat, Oct 10 at 12:00 PM, in person". */
export function callLabel(record: Row, fallbackTimeZone?: string): string {
  const when = callWhen(record, fallbackTimeZone);
  const how = MODE_WORDS[text(record.mode)];
  return how ? `${when}, ${how}` : when;
}
