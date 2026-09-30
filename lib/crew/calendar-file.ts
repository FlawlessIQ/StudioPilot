/**
 * Download a job as a calendar event (.ics), which every phone calendar opens.
 * Lifted from components/crew/assignment-actions.tsx so the offer screen and
 * the day sheet share one. Mirrors functions/src/crew/calendar-ics.ts, whose
 * "your date moved" email attachment updates this same event.
 */
export function downloadAssignmentCalendar(input: {
  assignmentId: string;
  startsAt: string;
  endsAt: string;
  projectName: string;
  role: string;
  location: string;
  /** Rises each time the date moves; see functions/src/crew/calendar-ics.ts. */
  sequence?: number;
}): void {
  const calendarDate = (value: string) =>
    new Date(value).toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const escaped = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudioCue//Crew Assignment//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.assignmentId}@studiocue`,
    // The same event every time: a higher SEQUENCE replaces the copy they
    // already added instead of adding a second one on the old date.
    `SEQUENCE:${Math.max(0, Math.floor(input.sequence ?? 0))}`,
    `DTSTAMP:${calendarDate(new Date().toISOString())}`,
    `DTSTART:${calendarDate(input.startsAt)}`,
    `DTEND:${calendarDate(input.endsAt)}`,
    `SUMMARY:${escaped(input.projectName)} — ${escaped(input.role)}`,
    `LOCATION:${escaped(input.location)}`,
    "DESCRIPTION:StudioCue crew assignment",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  link.download = `studiocue-${input.assignmentId}.ics`;
  link.click();
  URL.revokeObjectURL(link.href);
}
