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
  /** A draft the studio threw away before anyone saw it. Never shown to the couple. */
  "discarded",
  /** A sent proposal the studio took back. The couple is told it's no longer on offer. */
  "withdrawn",
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
  | "record_acceptance"
  /**
   * Correct a proposal that has already gone out, by superseding it.
   *
   * A sent quote must keep reading the way the client read it, so the record is
   * never mutated — a new version is written and the old one marked superseded.
   * Allowed from the states where the client has actually been given something
   * wrong, which is the only situation this exists for.
   */
  | "reissue"
  /**
   * The job's packages changed — the couple wants video as well, or a
   * different package — so the proposal is priced again from them. A draft is
   * re-priced in place; anything the couple has already been given, including
   * an accepted proposal whose agreement hasn't gone out, is superseded by a
   * new version they accept again. The accepted one stays as the record of
   * what they first agreed to.
   */
  | "revise_packages"
  /**
   * Throw a draft away. Nobody outside the studio has seen it, so there is
   * nothing to tell anyone; the job can start a new one straight away. GR asked
   * "where can I undo or delete a proposal" and had to delete the whole job to
   * start again (2026-09-30).
   */
  | "discard_draft"
  /**
   * Take back a proposal the couple has been sent. The record stays — it is
   * what they were offered — and their page says it's no longer on offer.
   * Never an accepted one: that is a booking, and changes to it are signed.
   */
  | "withdraw"
  /**
   * An acceptance recorded by mistake — the wrong job, or a "yes" that turned
   * out to be a "maybe". The proposal goes back to where it was and the job to
   * Proposal, while nothing has gone out on the strength of it. See
   * planUndoAcceptance below.
   */
  | "undo_acceptance";

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
  // Not from "accepted": that is the record of a deal, and correcting it would
  // rewrite what the client agreed to.
  reissue: ["sent", "viewed"],
  revise_packages: ["draft", "internal_review", "approved", "sent", "viewed", "accepted"],
  discard_draft: ["draft", "internal_review", "approved"],
  withdraw: ["sent", "viewed"],
  undo_acceptance: ["accepted"],
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

/**
 * The functions copy. features/proposals/eligibility.ts is the source of
 * truth; functions/ is a separate package with no "@/features" path, so the
 * rule is duplicated and tests/proposal-stage-eligibility.test.ts asserts the
 * two agree. The features/ copy also carries the verdict the composer uses to
 * explain a refusal — this side only ever needs the boolean.
 */
export function canCreateProposalForProject(state: string): boolean {
  return state === "CONSULTATION" || state === "PROPOSAL";
}

export function canApproveProposal(role: string): boolean {
  return role === "studio_owner" || role === "studio_admin";
}

export function canSendProposal(role: string): boolean {
  return canApproveProposal(role);
}

/**
 * Whether changing a job's packages must wait for an owner or admin.
 *
 * A proposal is priced from the job's packages, and every package change is
 * followed by `revise_packages` to re-price it — which only an owner or admin
 * may run. A coordinator's change landed, the re-price was refused, and the
 * couple was left holding a proposal the decision path refuses as
 * PACKAGE_SNAPSHOT_CONFLICT. So the change itself waits while any proposal
 * that revise would touch exists.
 */
export function packageChangeNeedsApprover(
  role: string,
  proposalStatuses: readonly string[],
): boolean {
  if (canApproveProposal(role)) return false;
  return proposalStatuses.some((status) =>
    actionStatuses.revise_packages.includes(status as ProposalStatus),
  );
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

/**
 * Undoing an acceptance, decided from the records. Pure.
 *
 * Nothing reversed `record_acceptance`, though CONTRACT_PENDING → PROPOSAL is
 * an edge the state machine has always allowed. `revise_packages` from an
 * accepted proposal got close, but only after a package change, and it was
 * refused the moment acceptance had prepared or sent a contract.
 *
 * The line is what has left the studio on the strength of the acceptance:
 *   - an agreement out for signature, or signed → refused; withdraw (void)
 *     the agreement first, which is its own deliberate act
 *   - an unsent contract draft StudioCue prepared on acceptance → discarded
 *     with it, since it was written for a deal that is no longer agreed
 *   - a standing bill → refused; void it first
 * An agreement the couple signed to accept (H2's booking agreement) is not an
 * acceptance to undo at all.
 */
export type UndoAcceptancePlan =
  | { ok: false; refusal: string }
  | {
      ok: true;
      /** The proposal's status before it was accepted. */
      restoreStatus: "approved" | "sent" | "viewed";
      discardDraft: boolean;
      acceptedByCouple: boolean;
    };

export const AGREEMENT_OUT = ["queued", "sent", "delivered", "viewed", "partially_signed", "completed", "signed"];
const RESTORABLE = ["approved", "sent", "viewed"] as const;

export function planUndoAcceptance(input: {
  proposal: {
    status: string;
    acceptancePriorStatus?: unknown;
    sentAt?: unknown;
    viewedAt?: unknown;
    acceptanceAuthority?: unknown;
    acceptedWithContractId?: unknown;
    combinedContractId?: unknown;
  };
  projectState: string;
  contractStatuses: readonly string[];
  /** contractDrafts/{projectId}, when it is for this proposal. */
  draftStatus: string | null;
  /** Bills on the job still owed (standing and not void). */
  standingInvoices: number;
}): UndoAcceptancePlan {
  if (input.proposal.status !== "accepted") return { ok: false, refusal: "PROPOSAL_NOT_ACCEPTED" };
  if (input.proposal.acceptedWithContractId || input.proposal.combinedContractId)
    return { ok: false, refusal: "ACCEPTED_BY_SIGNING" };
  if (input.projectState !== "CONTRACT_PENDING") return { ok: false, refusal: "PROJECT_PAST_ACCEPTANCE" };
  if (input.contractStatuses.some((status) => AGREEMENT_OUT.includes(status)))
    return { ok: false, refusal: "AGREEMENT_OUT_WITHDRAW_FIRST" };
  if (input.standingInvoices > 0) return { ok: false, refusal: "INVOICE_ALREADY_RAISED" };
  const recorded = String(input.proposal.acceptancePriorStatus ?? "");
  // Acceptances recorded before `acceptancePriorStatus` existed: read it off
  // the record's own dates, the furthest the couple is known to have got.
  const restoreStatus = (RESTORABLE as readonly string[]).includes(recorded)
    ? (recorded as (typeof RESTORABLE)[number])
    : input.proposal.viewedAt
      ? "viewed"
      : input.proposal.sentAt
        ? "sent"
        : "approved";
  return {
    ok: true,
    restoreStatus,
    discardDraft: input.draftStatus === "draft",
    acceptedByCouple: input.proposal.acceptanceAuthority !== "studio_attested",
  };
}
