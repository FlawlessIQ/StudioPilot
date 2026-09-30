/**
 * What the studio's proposal page may offer, decided the way the server
 * decides it.
 *
 * Every rule here mirrors a refusal in functions/src/booking/proposals.ts or
 * the couple's decision path. The page used to offer buttons the server then
 * refused (Discard on a proposal inside a live booking agreement), and to hide
 * facts the server acted on (a sent proposal past its expiry, which the couple
 * could no longer accept). Pure, no I/O.
 */

/**
 * The combined agreement's statuses that no longer hold the proposal.
 *
 * The server refuses resend, reissue, record_acceptance, send, discard_draft
 * and withdraw while the agreement is in any other status — including queued,
 * delivered, partially_signed and completed, which the page's old
 * "sent or viewed" check let through.
 */
export const COMBINED_AGREEMENT_RELEASED_STATUSES = ["voided", "failed", "superseded"] as const;

/**
 * Whether a proposal is held by a live booking agreement (H2).
 *
 * `contracts` null means they haven't loaded: keep the guarded view rather
 * than flash actions that may be refused. An agreement the list doesn't hold
 * is treated as the server treats a missing document — not live.
 */
export function combinedAgreementLive(
  combinedContractId: unknown,
  contracts: ReadonlyArray<{ id: string; status?: unknown }> | null,
): boolean {
  if (typeof combinedContractId !== "string" || !combinedContractId) return false;
  if (!contracts) return true;
  const contract = contracts.find((record) => record.id === combinedContractId);
  if (!contract) return false;
  return !(COMBINED_AGREEMENT_RELEASED_STATUSES as readonly string[]).includes(
    String(contract.status ?? ""),
  );
}

/**
 * A sent proposal the couple can no longer accept because its date passed.
 *
 * Nothing on the server writes `expired`: the couple's page computes it and
 * the decision refuses with PROPOSAL_EXPIRED. An unreadable expiry is refused
 * there too, so it counts as lapsed here.
 */
export function proposalHasLapsed(status: unknown, expiresAt: unknown, now: number): boolean {
  if (!["sent", "viewed"].includes(String(status))) return false;
  const expiry = new Date(String(expiresAt ?? "")).valueOf();
  return Number.isNaN(expiry) || expiry <= now;
}

export type DraftForm = {
  notes: string;
  termsSummary: string;
  expiresOn: string;
  retainerDueDate: string;
  balanceDueDate: string;
  /** Dollars the studio typed; null is "as the proposal has it". */
  draftRetainer: string | null;
};

/**
 * Whether the draft form holds edits the proposal doesn't.
 *
 * "Approve this proposal" ran submit and approve straight from the record, so
 * a retainer, note or date typed and not saved was silently dropped from what
 * the couple was sent. Compared field by field against the same values the
 * form was loaded with.
 */
export function draftFormDirty(loaded: DraftForm, current: DraftForm): boolean {
  if (current.draftRetainer !== null) return true;
  return (
    loaded.notes !== current.notes ||
    loaded.termsSummary !== current.termsSummary ||
    loaded.expiresOn !== current.expiresOn ||
    loaded.retainerDueDate !== current.retainerDueDate ||
    loaded.balanceDueDate !== current.balanceDueDate
  );
}

const messageOf = (caught: unknown) =>
  caught instanceof Error ? caught.message : String(caught ?? "");

/**
 * A package change that had already happened — a retry after the change
 * landed and the re-price didn't. The proposal still has to be revised, so
 * callers carry on to `revise_packages` rather than stop here.
 */
export function packageChangeAlreadyApplied(caught: unknown): boolean {
  const message = messageOf(caught);
  return message.includes("PACKAGE_ALREADY_ON_JOB") || message.includes("PACKAGE_NOT_ON_JOB");
}

/**
 * `revise_packages` refused because this version was already revised: the
 * earlier attempt went through and superseded it. The re-price the caller
 * wanted exists; there is just no new id to hand back.
 */
export function proposalAlreadyRevised(caught: unknown): boolean {
  return messageOf(caught).includes("PROPOSAL_ACTION_NOT_ALLOWED:revise_packages:superseded");
}

/** The statuses `revise_packages` accepts, and so where a package change must be followed by one. */
export const REVISABLE_PROPOSAL_STATUSES = [
  "draft",
  "internal_review",
  "approved",
  "sent",
  "viewed",
  "accepted",
] as const;

/**
 * The newest proposal the couple has been given and could still answer or
 * has accepted — the one a package change on the job would leave stale.
 */
export function proposalWithCouple<T extends { id: string; status?: unknown; version?: unknown }>(
  proposals: readonly T[],
): T | null {
  return (
    [...proposals]
      .filter((proposal) => ["sent", "viewed", "accepted"].includes(String(proposal.status)))
      .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0] ?? null
  );
}

/**
 * Contract statuses that mean an agreement has gone out (or been signed) on
 * the strength of an acceptance. While one exists the server refuses
 * `undo_acceptance` — mirrors AGREEMENT_OUT in
 * functions/src/booking/proposal-domain.ts; tests/wave3-undo.test.ts holds the
 * two lists together.
 */
export const ACCEPTANCE_AGREEMENT_OUT: readonly string[] = [
  "queued",
  "sent",
  "delivered",
  "viewed",
  "partially_signed",
  "completed",
  "signed",
];
