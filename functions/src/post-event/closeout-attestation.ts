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

/** Proven by the records, or vouched for by a person who may vouch for it. */
export function requirementIsSatisfied(
  requirement: CloseoutRequirement,
): boolean {
  if (requirement.complete === true) return true;
  if (!requirement.attestation) return false;
  // An attestation on a key that may not be attested counts for nothing, even
  // if one somehow reached the record.
  return requirementIsAttestable(requirement.key);
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
