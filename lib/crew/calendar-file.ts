/**
 * Download a job as a calendar event (.ics), which every phone calendar opens.
 * Lifted from components/crew/assignment-actions.tsx so the offer screen and
 * the day sheet share one.
 */
export function downloadAssignmentCalendar(input: {
  assignmentId: string;
  startsAt: string;
  endsAt: string;
  projectName: string;
  role: string;
  location: string;
}): void {
  const calendarDate = (value: string) =>
    new Date(value).toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\.\d{3}Z$/, "Z");
  const escaped = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll("\n", "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudioCue//Crew Assignment//EN",
    "BEGIN:VEVENT",
    `UID:${input.assignmentId}@studiocue`,
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
