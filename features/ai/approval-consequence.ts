/**
 * What approving an AI draft actually does, said before it is done.
 *
 * The walk of 2026-08-26 found the review card promising the opposite of what
 * happened. Above the draft it said "Approving saves the draft. Nothing goes to
 * the client until you send it." One second after approving, the same card said
 * "Approved and queued the email for secure delivery", and the outbound message
 * was written with `sentAt` set. A third surface, the inquiry page, labelled the
 * same record "AI-PREPARED · UNSENT".
 *
 * The behaviour is the sound half: `approvedCommunicationDispatch` in
 * functions/src/ai/approved-communication.ts queues the email when it has a
 * valid recipient, a subject and a body, and the write is idempotent so nothing
 * is ever sent twice. What was wrong was the sentence. This is the same
 * condition that function uses, so the card can promise what the server will
 * actually do — change both together.
 */

const validEmail = (value: string | null | undefined) =>
  Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

export type ApprovalConsequenceInput = {
  /** A downstream command, when approving runs one. */
  downstreamCommandType: string | null;
  recipient: string | null;
  subject: string | null;
  body: string | null;
};

/**
 * Whether approving this draft sends it, rather than merely saving it.
 *
 * Mirrors the `queued` condition in `approvedCommunicationDispatch`.
 */
export function dispatchesOnApproval(input: ApprovalConsequenceInput): boolean {
  if (input.downstreamCommandType) return false;
  return (
    validEmail(input.recipient) &&
    (input.subject ?? "").trim().length > 0 &&
    (input.body ?? "").trim().length > 0
  );
}

/**
 * One sentence naming the consequence, in the second person.
 *
 * Names the recipient when the mail is going out. A photographer about to send
 * a stranger their prices should see the address they are sending to.
 */
export function approvalConsequenceSentence(
  input: ApprovalConsequenceInput,
  readable: (value: string) => string,
): string {
  if (input.downstreamCommandType) {
    return `Approving runs ${readable(input.downstreamCommandType).toLowerCase()}.`;
  }
  if (dispatchesOnApproval(input)) {
    return `Approving emails this to ${input.recipient} straight away.`;
  }
  return "Approving saves the draft. Nothing goes to the client until you send it.";
}
