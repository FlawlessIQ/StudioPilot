export const proposalStatuses = [
  "draft",
  "internal_review",
  "approved",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
  "superseded",
] as const;

export type ProposalStatus = (typeof proposalStatuses)[number];

export type ProposalAction =
  | "update_draft"
  | "submit_for_approval"
  | "return_to_draft"
  | "approve"
  | "regenerate_pdf"
  | "send"
  | "resend"
  /**
   * The couple said yes somewhere else — by email, on the phone, in person.
   * Only a proposal they have actually been given: recording an acceptance of a
   * draft nobody has seen would be recording agreement to a price never quoted.
   */
  | "record_acceptance";

const actionStatuses: Readonly<Record<ProposalAction, readonly ProposalStatus[]>> = {
  update_draft: ["draft"],
  submit_for_approval: ["draft"],
  return_to_draft: ["internal_review", "approved"],
  approve: ["internal_review"],
  regenerate_pdf: ["approved"],
  send: ["approved"],
  resend: ["sent", "viewed"],
  /**
   * `approved` is included deliberately.
   *
   * A studio that emailed their own PDF, or whose branded send failed, never
   * gets the proposal past `approved` — and sending is itself gated on a ready
   * PDF. Refusing an attestation here would leave a couple's "yes" with no way
   * into StudioCue at all. `draft` and `internal_review` stay out: nothing has
   * been priced and approved yet, so there is nothing a client could have
   * agreed to.
   */
  record_acceptance: ["approved", "sent", "viewed"],
};

export function assertProposalAction(
  status: string,
  action: ProposalAction,
): asserts status is ProposalStatus {
  if (!proposalStatuses.some((candidate) => candidate === status)) {
    throw new Error("PROPOSAL_STATUS_INVALID");
  }
  if (!actionStatuses[action].includes(status as ProposalStatus)) {
    throw new Error(`PROPOSAL_ACTION_NOT_ALLOWED:${action}:${status}`);
  }
}

export function canCreateProposalForProject(state: string): boolean {
  return state === "CONSULTATION" || state === "PROPOSAL";
}

export function canApproveProposal(role: string): boolean {
  return role === "studio_owner" || role === "studio_admin";
}

export function canSendProposal(role: string): boolean {
  return canApproveProposal(role);
}

export function proposalEmailDeliveryStatus(event: string): string | null {
  return [
    "processed",
    "delivered",
    "deferred",
    "bounce",
    "dropped",
    "open",
    "click",
  ].includes(event)
    ? event
    : null;
}
