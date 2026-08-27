/**
 * Closing a job whose last few requirements are not the studio's to satisfy.
 *
 * The closeout reconciler reads the records correctly — I checked each of its
 * eight requirements against the code before changing anything, and every label
 * matches its check. "Gallery delivered **and accessed**" is false because the
 * delivery is `sent` and the couple has not opened it. "Review request **sent**"
 * is false because the asks are `scheduled` and have not gone out. Those are
 * honest answers, not the stale-checkpoint fault that readiness had.
 *
 * The problem is what a studio can do about them. A couple who never clicks the
 * gallery link, a second shooter who never files their closeout, a COI that was
 * emailed to the venue from the photographer's own account — each leaves a
 * finished wedding permanently open, with no way through. That is the same
 * shape as the retainer a couple paid by bank transfer: the product is right
 * that it has no evidence, and wrong to make that the end of the conversation.
 *
 * So a studio may vouch for a requirement, and the vouching is recorded.
 *
 * Two are deliberately not attestable. The signed contract and the settled
 * final balance are the two things a studio must never be able to tick with a
 * sentence — money and the agreement. Both already have proper attestation
 * paths that write real evidence (`recordSignedAgreement`,
 * `recordRetainerPayment`); a free-text note beside them would be a hole in the
 * books, not a convenience.
 *
 * Pure functions, no I/O.
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
