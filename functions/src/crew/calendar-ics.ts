/**
 * A crew assignment as a calendar event (.ics).
 *
 * The UID is the assignment's, so every copy of the event — the one a crew
 * member downloaded from their crew app, and the update attached to a
 * "your date moved" email — is the same event to their calendar. SEQUENCE
 * rises each time the date moves (`calendarSequence` on the assignment), which
 * is what tells Apple Calendar, Outlook and Google to move the event they
 * already have rather than add a second one.
 *
 * Mirrored in lib/crew/calendar-file.ts for the in-app download;
 * tests/booking-amendment.test.ts fails if the two disagree on the UID.
 */

const calendarDate = (value: string) =>
  new Date(value).toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");

const escaped = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");

export function assignmentCalendarUid(assignmentId: string): string {
  return `${assignmentId}@studiocue`;
}

export function assignmentIcs(input: {
  assignmentId: string;
  startsAt: string;
  endsAt: string;
  projectName: string;
  role: string;
  location: string;
  sequence: number;
  stampedAt: string;
  /**
   * The studio withdrew this person. Same UID and a higher SEQUENCE, marked
   * cancelled, which is how Apple Calendar, Outlook and Google take an event
   * out of a diary they already hold it in rather than leaving a wedding in
   * it that nobody is expecting them at.
   */
  cancelled?: boolean;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudioCue//Crew Assignment//EN",
    input.cancelled ? "METHOD:CANCEL" : "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${assignmentCalendarUid(input.assignmentId)}`,
    `SEQUENCE:${Math.max(0, Math.floor(input.sequence))}`,
    ...(input.cancelled ? ["STATUS:CANCELLED"] : []),
    `DTSTAMP:${calendarDate(input.stampedAt)}`,
    `DTSTART:${calendarDate(input.startsAt)}`,
    `DTEND:${calendarDate(input.endsAt)}`,
    `SUMMARY:${escaped(input.projectName)} — ${escaped(input.role)}`,
    `LOCATION:${escaped(input.location)}`,
    "DESCRIPTION:StudioCue crew assignment",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** "The Boro Hotel, 38-28 27th Street" — the first place on the assignment. */
export function assignmentPlace(locations: unknown): string {
  const first = Array.isArray(locations) ? (locations[0] as Record<string, unknown> | undefined) : undefined;
  return [first?.name, first?.address].filter((part) => typeof part === "string" && part).join(", ");
}
