/**
 * Whether a person at the studio wrote or approved an email to a client.
 *
 * Today's client-message card leaves when the studio answers
 * (features/messaging/awaiting-studio.ts). Every client send moved the
 * thread's lastOutboundAt, so a client who asked a question and got "your
 * questionnaire is due in 3 days" an hour later read as answered, and the card
 * never showed (review of the 2026-10-12 prod walk fix). The email worker
 * (operations/jobs.ts saveMessage) asks this instead, and only a yes moves
 * the thread's lastStudioReplyAt.
 *
 * The studio's own words go out as `manual_message`, from a person: a reply in
 * Messages and a composed message carry `requestedBy`; a coordinator's draft
 * the owner approved and a Cue draft approved on Today carry
 * `communicationDraftId`; a reply approved from the studio's notification
 * email says so (`studioReply`, app/api/reply-approval). The automatic ones
 * carry none of these: a lifecycle message or "Ahead of our call" sent under
 * the studio's auto-send setting, a workflow step ("automation-engine"), a
 * booking change confirmed on signing. Every template type is a reminder,
 * notice or receipt.
 *
 * A miss here costs one tap ("No reply needed" on Today); a false yes is the
 * silent miss this exists to stop, so anything unrecognised is a no.
 */
export function studioWroteIt(job: { get(field: string): unknown }): boolean {
  if (job.get("type") !== "manual_message") return false;
  if (job.get("studioReply") === true) return true;
  const requestedBy = job.get("requestedBy");
  if (typeof requestedBy === "string" && requestedBy && requestedBy !== "automation-engine") {
    return true;
  }
  const draftId = job.get("communicationDraftId");
  return typeof draftId === "string" && draftId.length > 0;
}
