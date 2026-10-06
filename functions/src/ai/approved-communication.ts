import { approvedEmailJobId, heldSendFields } from "../communications/undo-send.js";

type ApprovedCommunicationInput = {
  actionId: string;
  tenantId: string;
  projectId: string | null;
  /** The lead a reply answers, so it is sent on — and answered into — the lead's thread. */
  leadId?: string | null;
  contactId: string | null;
  recipient: string | null;
  recipientName: string | null;
  projectName: string | null;
  subject: string;
  body: string;
  category: string;
  now: string;
  /** Who approved it: they may call a held send back (communications/undo-send.ts). */
  requestedBy?: string;
  /** Hold the email for the undo window rather than sending at once (Today's one-tap send). */
  holdForUndo?: boolean;
  /** How many times an earlier approval of this draft was undone; picks a fresh job id. */
  undoCount?: number;
  /** The email's one button, when the draft carries one (a payment reminder's pay link). */
  action?: { label: string; url: string } | null;
  /**
   * A payment reminder's invoice, read again as the email goes
   * (operations/jobs.ts): a bill paid in the meantime is not chased.
   */
  paymentReminderInvoiceId?: string | null;
};

/**
 * The AI capabilities whose approval *is* the send.
 *
 * Only the first three used to be here. The lifecycle drafts (T-30 schedule
 * confirmation, T-30 final balance, T-1 checklist), the delivery note, the
 * album reminder and the review request were all written as
 * `delivery_message_draft` / `review_request_draft`, shown with "Approve &
 * send", and then answered "No provider action was executed" — the studio
 * approved a couple's email and nothing went.
 *
 * `proposal_draft` is deliberately absent: a proposal cover travels with the
 * proposal, and sending it alone would mail a couple a letter about an
 * attachment that is not there. Its card says approving only saves it.
 *
 * Mirrored in features/ai/approval-consequence.ts so the card promises what
 * this does; tests/wave0-email.test.ts keeps the two lists identical.
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
  return (SEND_ON_APPROVAL_CAPABILITIES as readonly string[]).includes(
    capability,
  );
}

/** The mail category a capability's email is filed under. */
export function communicationCategoryFor(capability: string): string {
  return capability === "planning_followup_draft" ? "planning" : "general";
}

const validEmail = (value: string | null) =>
  Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

export function approvedCommunicationDispatch(
  input: ApprovedCommunicationInput,
) {
  const queued =
    validEmail(input.recipient) &&
    input.subject.trim().length > 0 &&
    input.body.trim().length > 0;
  return {
    draftStatus: queued ? "queued" : "approved_unsent",
    consequence: queued
      ? "Approved and queued the email for secure delivery."
      : "Approved the draft, but kept it unsent because a valid recipient or message detail is missing.",
    emailJob: queued
      ? {
          id: approvedEmailJobId(input.actionId, input.undoCount ?? 0),
          tenantId: input.tenantId,
          projectId: input.projectId,
          leadId: input.leadId ?? null,
          contactId: input.contactId,
          recipient: input.recipient,
          recipientName: input.recipientName,
          projectName: input.projectName,
          type: "manual_message",
          customSubject: input.subject,
          customBody: input.body,
          actionLabel: input.action?.label ?? null,
          actionUrl: input.action?.url ?? null,
          ...(input.paymentReminderInvoiceId
            ? { paymentReminderInvoiceId: input.paymentReminderInvoiceId }
            : {}),
          category: input.category,
          communicationDraftId: `ai_reply_${input.actionId}`,
          aiActionId: input.actionId,
          // The job's contact rules are read again as the email goes
          // (operations/jobs.ts): a job archived, paused or cancelled between
          // approval and send must not still reach the couple.
          clientOutreachGuard: true,
          status: "queued",
          scheduledFor: null,
          attempts: 0,
          requestedBy: input.requestedBy ?? null,
          ...(input.holdForUndo
            ? heldSendFields(input.now, input.requestedBy ?? "")
            : {}),
          createdAt: input.now,
          updatedAt: input.now,
        }
      : null,
  } as const;
}
