/**
 * Which meeting formats and in-person address a consultation-settings save
 * keeps.
 *
 * The calendar's Block day / Unblock day saves the settings it knows about —
 * hours, buffer, blocked dates — and never knew about meeting formats. The
 * command defaulted what it wasn't sent (["zoom"], null) and wrote the whole
 * document, so blocking a day quietly reset "How you meet" to video only and
 * cleared the in-person address. Couples booking through the inquiry link
 * then lost the options the studio had chosen.
 *
 * A field the caller doesn't send now keeps what was saved; a field it sends
 * — including an explicit null address — replaces it.
 */

export type MeetingFormat = "zoom" | "in_person" | "phone";
const FORMATS: readonly MeetingFormat[] = ["zoom", "in_person", "phone"];

export function keptMeetingSettings(
  input: { meetingFormats?: MeetingFormat[]; inPersonLocation?: string | null },
  saved: Record<string, unknown> | null | undefined,
): { meetingFormats: MeetingFormat[]; inPersonLocation: string | null } {
  const savedFormats = Array.isArray(saved?.meetingFormats)
    ? (saved.meetingFormats as unknown[]).filter((f): f is MeetingFormat => FORMATS.includes(f as MeetingFormat))
    : [];
  const savedLocation = typeof saved?.inPersonLocation === "string" ? saved.inPersonLocation : null;
  return {
    meetingFormats: input.meetingFormats ?? (savedFormats.length ? savedFormats : ["zoom"]),
    inPersonLocation: input.inPersonLocation !== undefined ? input.inPersonLocation : savedLocation,
  };
}
