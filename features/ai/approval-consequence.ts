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

/**
 * The capabilities whose approval sends the email. A copy of
 * SEND_ON_APPROVAL_CAPABILITIES in functions/src/ai/approved-communication.ts
 * (functions/ is a separate package); tests/wave0-email.test.ts keeps them
 * identical. A message draft outside this list — a proposal cover — is only
 * saved by approving, and the card must say so rather than "emails this".
 */
export const SEND_ON_APPROVAL_CAPABILITIES = [
  "inquiry_reply_draft",
  "planning_followup_draft",
  "inquiry_follow_up",
  "delivery_message_draft",
  "review_request_draft",
  // "Ahead of our call" (functions/src/booking/consultation-prep.ts).
  "consultation_prep_draft",
] as const;

export function sendsOnApproval(capability: string): boolean {
  return (SEND_ON_APPROVAL_CAPABILITIES as readonly string[]).includes(capability);
}

export type ApprovalConsequenceInput = {
  /**
   * What kind of draft this is. When given, only a capability the server
   * sends on approval is promised as a send. Omitted by older callers, which
   * keeps the recipient/subject/body rule alone.
   */
  capability?: string | null;
  /** A downstream command, when approving runs one. */
  downstreamCommandType: string | null;
  recipient: string | null;
  subject: string | null;
  body: string | null;
};

/**
 * The command a draft names, when it is a command at all.
 *
 * An inquiry reply names `create_communication_draft` as its downstream —
 * which is not another command but the email path itself: the server sends
 * inquiry and planning replies on approval, keyed by capability. Read as "a
 * command", it made the review sheet say "Approving runs create communication
 * draft" above a reply that approving emails to the couple — the 2026-08-26
 * failure this file exists to prevent — and then offer "Send reply now" for a
 * reply that had already gone. Found reviewing Today's inquiry card, 2026-09-26.
 */
function commandOf(input: ApprovalConsequenceInput): string | null {
  return input.downstreamCommandType === "create_communication_draft"
    ? null
    : input.downstreamCommandType;
}

/**
 * Whether approving this draft sends it, rather than merely saving it.
 *
 * Mirrors the `queued` condition in `approvedCommunicationDispatch`.
 */
export function dispatchesOnApproval(input: ApprovalConsequenceInput): boolean {
  if (commandOf(input)) return false;
  if (input.capability && !sendsOnApproval(input.capability)) return false;
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
/**
 * A natural sentence for the copilot's proposed non-email commands, keyed by the
 * downstream commandType. Falls back to a generic "Approving runs …" for any
 * command not named here, so a new command type is never left without copy.
 */
const COMMAND_CONSEQUENCE: Record<string, string> = {
  create_task: "Approving adds this task to the project.",
  set_insurance_required: "Approving flags that the venue requires insurance.",
  create_proposal_draft:
    "Approving creates an unsent proposal draft you can review before sending.",
  send_crew_offer: "Approving emails this crew offer to the photographer.",
  assign_questionnaire: "Approving sends the questionnaire to the client.",
  request_coi: "Approving emails the insurance request to the agent.",
};

export function approvalConsequenceSentence(
  input: ApprovalConsequenceInput,
  readable: (value: string) => string,
): string {
  const command = commandOf(input);
  if (command) {
    return (
      COMMAND_CONSEQUENCE[command] ??
      `Approving runs ${readable(command).toLowerCase()}.`
    );
  }
  if (dispatchesOnApproval(input)) {
    return `Approving emails this to ${input.recipient} right away.`;
  }
  if (input.capability && !sendsOnApproval(input.capability) && input.body) {
    return "Approving saves the draft. It isn't emailed from here.";
  }
  return "Approving saves the draft. Nothing goes to the client until you send it.";
}
