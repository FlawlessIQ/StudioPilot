/**
 * When the couple's event form saves itself, and when it stops trying.
 *
 * It retried every 1.5 seconds without end. On 2026-10-07 Gabe deleted a test
 * job while Albert was filling in its form, and the page sent about 400 saves
 * in ten minutes, each refused, while still showing "Saving shortly…" and an
 * active Send. A save the server refuses for good ends the form; a save that
 * failed for a reason that may pass waits longer each time.
 */

/** Refusals no retry can change: the link, the inquiry or the form is gone. */
const FINAL = new Set([
  "INQUIRY_LINK_NOT_FOUND",
  "INQUIRY_LINK_CLOSED",
  "INQUIRY_PAST_CONSULTATION",
  "INQUIRY_FORM_NOT_AVAILABLE",
  "QUESTIONNAIRE_ALREADY_SUBMITTED",
]);

export function saveFailureIsFinal(code: string): boolean {
  return FINAL.has(code);
}

/** The pause before the next autosave: 1.5s, then doubling to a minute. */
export function autosaveDelayMs(failures: number): number {
  return Math.min(1_500 * 2 ** Math.max(0, failures), 60_000);
}
