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

/**
 * Why a requirement is still open, when the answer is "nothing yet, by design".
 *
 * Minutes after releasing a gallery, a studio was shown "Gallery delivered and
 * accessed" and "Review request sent" as outstanding, each with a "Mark as
 * done" button and no explanation. Both were correct and neither was theirs to
 * do: the review asks are scheduled for three and ten days out, and the
 * delivery clears when the couple confirms the download. The only route the
 * screen offered was to vouch for something that had not happened.
 *
 * So say what it is waiting for. The button stays — a couple who never clicks
 * is exactly why it exists — but it stops being the only thing on the row.
 */
export type CloseoutPendingContext = {
  /** Earliest review ask not yet sent, and where it goes. */
  reviewScheduledAt?: string | null;
  reviewChannel?: string | null;
  /** When the gallery went out, if it has. */
  deliverySentAt?: string | null;
  /** The album workflow's status, if this job has one. */
  albumStatus?: string | null;
};

const shortDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
};

export function closeoutPendingNote(
  key: string,
  context: CloseoutPendingContext,
  formatDate: (value: string) => string = shortDate,
): string | null {
  if (key === "delivery" && context.deliverySentAt) {
    const sent = formatDate(context.deliverySentAt);
    return `The gallery went out${sent ? ` on ${sent}` : ""}. This settles itself once they open it and confirm the download in their portal.`;
  }
  if (key === "review_request" && context.reviewScheduledAt) {
    const due = formatDate(context.reviewScheduledAt);
    const where =
      context.reviewChannel === "portal" ? "in their portal" : "by email";
    return due
      ? `Nothing to do yet — the first ask goes out ${where} on ${due}.`
      : `Nothing to do yet — the first ask is scheduled ${where}.`;
  }
  if (key === "album" && context.albumStatus === "instructions_available")
    return "Waiting on their album selections. Reminders go out a week and a fortnight after delivery.";
  return null;
}
