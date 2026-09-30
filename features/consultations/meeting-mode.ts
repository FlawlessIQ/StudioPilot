import type { CapabilityReadiness } from "@/features/integrations/capability-readiness";

/**
 * How a new consultation meets, before the studio chooses.
 *
 * Zoom was the default everywhere a consultation is made — the calendar's
 * booking form, Cue's card, the "invite them to choose a time" link, the
 * formats a couple is offered — whether or not the studio had connected Zoom.
 * Most had not, so the default produced a "video call" with no link at all.
 * With Zoom connected it stays the default; without it, a phone call, which
 * needs nothing connected. Unknown (still loading, or the status could not be
 * read) is treated as not connected: a phone call that could have been Zoom
 * costs a click, a Zoom call with no link costs the meeting.
 */
export type ConsultationMode = "zoom" | "in_person" | "phone";

export function zoomIsConnected(readiness: CapabilityReadiness | null): boolean {
  return readiness?.provider === "zoom" && (readiness.state === "ready" || readiness.state === "degraded");
}

export function defaultConsultationMode(zoomConnected: boolean | null): ConsultationMode {
  return zoomConnected ? "zoom" : "phone";
}

/** The formats a couple is offered before the studio has said which. */
export function defaultMeetingFormats(zoomConnected: boolean | null): ConsultationMode[] {
  return [defaultConsultationMode(zoomConnected)];
}

/** The line under "Video call" in settings, true to what will happen. */
export function videoCallDetail(zoomConnected: boolean | null): string {
  if (zoomConnected === null) return "A Zoom link goes out with the confirmation when Zoom is connected.";
  return zoomConnected
    ? "A Zoom link goes out with the confirmation."
    : "Zoom isn't connected, so you send them the link. Connect Zoom and it goes out with the confirmation.";
}
