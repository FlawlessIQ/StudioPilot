/**
 * Closeout attestation — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/post-event/closeout-attestation.ts. That copy holds the tests
 * and is the source of truth; change both together.
 */

export type CloseoutAttestation = {
  attestedBy: string;
  attestedAt: string;
  note: string;
};

export type CloseoutRequirement = {
  key: string;
  label: string;
  complete: boolean;
  evidenceId?: string | null;
  attestation?: CloseoutAttestation | null;
  /**
   * Set by the reconciler, never by a client (projectCloseouts are
   * server-written): the job carries no package snapshot, so no price was
   * agreed in StudioCue and there is no balance to record a payment against.
   */
  noAgreedBalance?: boolean;
};

/**
 * Requirements a studio may vouch for, because each can genuinely be satisfied
 * somewhere StudioCue cannot see.
 */
export const ATTESTABLE_CLOSEOUT_KEYS: readonly string[] = [
  "schedule",
  "delivery",
  "album",
  "review_request",
  "crew",
  "insurance",
];

/** Money and the agreement. Evidence only — see the note above. */
export const EVIDENCE_ONLY_CLOSEOUT_KEYS: readonly string[] = [
  "contract",
  "final_balance",
];

export function requirementIsAttestable(key: string): boolean {
  return ATTESTABLE_CLOSEOUT_KEYS.includes(key);
}

/**
 * Whether this requirement, as the reconciler wrote it, may be vouched for.
 *
 * The attestable keys, plus one narrow exception (Wave 2): the final balance
 * on a job with no package snapshot — an imported or legacy booking. The
 * proper path, `recordFinalPayment`, reads the agreed balance off the
 * snapshot and so cannot run; the row offered nothing, and "Check again"
 * looped forever on a job that could never close. With no agreed price there
 * is no number a note could misstate, so a note is the honest record.
 */
export function requirementMayBeAttested(requirement: CloseoutRequirement): boolean {
  if (requirementIsAttestable(requirement.key)) return true;
  return requirement.key === "final_balance" && requirement.noAgreedBalance === true;
}

/** Proven by the records, or vouched for by a person who may vouch for it. */
export function requirementIsSatisfied(
  requirement: CloseoutRequirement,
): boolean {
  if (requirement.complete === true) return true;
  if (!requirement.attestation) return false;
  // An attestation on a key that may not be attested counts for nothing, even
  // if one somehow reached the record.
  return requirementMayBeAttested(requirement);
}

export function closeoutStatusFrom(
  requirements: readonly CloseoutRequirement[],
): "ready" | "blocked" {
  return requirements.every(requirementIsSatisfied) ? "ready" : "blocked";
}

/** What is still in the way, named, for the studio to read. */
export function outstandingCloseoutLabels(
  requirements: readonly CloseoutRequirement[],
): string[] {
  return requirements
    .filter((requirement) => !requirementIsSatisfied(requirement))
    .map((requirement) => requirement.label || requirement.key);
}
