/**
 * Correcting a certificate of insurance request (wave 3). Pure, so the rules
 * are tested directly; planning/commands.ts and coi/actions.ts apply them.
 */

/**
 * A request still in motion: something StudioCue will do, chase or show on
 * Today. Setting the job to "not required" used to leave these alone, so the
 * chase scheduler kept emailing the agent about a certificate nobody needed
 * and the Today card stayed. A certificate already at the venue is history,
 * not an open request, and is left as it is.
 */
export const OPEN_COI_STATUSES: readonly string[] = [
  "prepared",
  "needs_details",
  "self_serve",
  "requested",
  "awaiting_response",
  "correction_required",
  "received",
  "under_review",
  "approved",
  "failed",
];

export function coiRequestIsOpen(request: { status?: unknown; archivedAt?: unknown }): boolean {
  return !request.archivedAt && OPEN_COI_STATUSES.includes(String(request.status ?? ""));
}

/**
 * Where "approve & send to the venue" may start. `correction_required` is in:
 * the studio sent it back and then decided it was right after all (or the
 * agent phoned to explain) — `decideCoi` has always allowed approving from
 * there, and the card offered only a note.
 */
export const COI_APPROVABLE_STATUSES: readonly string[] = ["under_review", "approved", "correction_required"];

/**
 * Sending again with corrected details.
 *
 * - To the agent, while the certificate is still being asked for: the venue's
 *   legal name or address on the request was wrong, or it went to the wrong
 *   agent. Same reply address, so an answer to either email lands here.
 * - To the venue, once it was sent: it went to the wrong venue address. Owner
 *   or admin, as the first send was.
 */
export type CoiResend = { ok: true; to: "agent" | "venue" } | { ok: false; refusal: string };

export function planCoiResend(input: {
  status: string;
  role: string;
  /** What the studio corrected. */
  submissionEmail: string | null;
  venueDetailsChanged: boolean;
  agentEmail: string | null;
}): CoiResend {
  if (["requested", "awaiting_response", "correction_required"].includes(input.status)) {
    if (!input.venueDetailsChanged && !input.agentEmail) return { ok: false, refusal: "COI_NOTHING_CORRECTED" };
    return { ok: true, to: "agent" };
  }
  if (["sent_to_venue", "venue_acknowledged"].includes(input.status)) {
    if (!["studio_owner", "studio_admin"].includes(input.role)) return { ok: false, refusal: "FORBIDDEN" };
    if (!input.submissionEmail) return { ok: false, refusal: "COI_VENUE_EMAIL_REQUIRED" };
    return { ok: true, to: "venue" };
  }
  return { ok: false, refusal: "COI_NOT_RESENDABLE" };
}
