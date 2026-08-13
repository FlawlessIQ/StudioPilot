type ApprovedCommunicationInput = {
  actionId: string;
  tenantId: string;
  projectId: string | null;
  contactId: string | null;
  recipient: string | null;
  recipientName: string | null;
  projectName: string | null;
  subject: string;
  body: string;
  category: string;
  now: string;
};

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
          id: `ai_message_${input.actionId}`,
          tenantId: input.tenantId,
          projectId: input.projectId,
          contactId: input.contactId,
          recipient: input.recipient,
          recipientName: input.recipientName,
          projectName: input.projectName,
          type: "manual_message",
          customSubject: input.subject,
          customBody: input.body,
          actionLabel: null,
          actionUrl: null,
          category: input.category,
          communicationDraftId: `ai_reply_${input.actionId}`,
          status: "queued",
          scheduledFor: null,
          attempts: 0,
          createdAt: input.now,
          updatedAt: input.now,
        }
      : null,
  } as const;
}
