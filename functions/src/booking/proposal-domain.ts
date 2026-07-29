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
  | "resend";

const actionStatuses: Readonly<Record<ProposalAction, readonly ProposalStatus[]>> = {
  update_draft: ["draft"],
  submit_for_approval: ["draft"],
  return_to_draft: ["internal_review", "approved"],
  approve: ["internal_review"],
  regenerate_pdf: ["approved"],
  send: ["approved"],
  resend: ["sent", "viewed"],
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
