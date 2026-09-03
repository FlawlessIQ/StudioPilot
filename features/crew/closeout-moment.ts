/**
 * Whether a crew member still owes the studio their work record.
 *
 * The crew home page built its headline from two things — invitations to answer
 * and a schedule to acknowledge — and closeout was not one of them. So a second
 * shooter who had shot a wedding nineteen days earlier, had not submitted his
 * hours, and was owed **$800** that the studio could not schedule until he did,
 * opened his workspace to "**Nothing needs you right now.**"
 *
 * He was waiting on the studio, the studio was waiting on him, and neither was
 * told. It is the only item in that workspace with money attached, and the
 * reason a subcontractor opens the app at all.
 *
 * The data was two clicks away the whole time: the prep page renders "After the
 * event · Hours, expenses & deliverables · Not submitted" from the same field.
 *
 * Pure predicates, no I/O — and shared, because the closeout page had its own
 * copy of the submitted test. Two derivations of one question is the class that
 * gave readiness three different percentages.
 */

/**
 * Statuses that mean the record has left his hands.
 *
 * `needs_changes` is deliberately **not** here: the studio asked him for
 * something, so it is his again. The closeout page already says so —
 * "The studio requested changes" — and the home page has to agree.
 */
const SETTLED: readonly string[] = ["submitted", "approved", "paid"];

export function crewCloseoutIsSubmitted(status: string): boolean {
  return SETTLED.includes(status);
}

export type CloseoutMoment = {
  /** True when this assignment is his to complete now. */
  due: boolean;
  /** Why, in the words the workspace should use. */
  reason: "not_submitted" | "needs_changes" | null;
};

/**
 * Whether this assignment's closeout is his to do.
 *
 * Only once the day has gone — hours and expenses cannot be recorded for work
 * not yet done, and prompting for them beforehand would be the mirror of the
 * defect that had a schedule acknowledgement leading the page thirteen days
 * after the wedding was shot.
 */
export function crewCloseoutMoment(input: {
  status: string;
  closeoutStatus: string;
  /** Departure, or arrival when there is no departure. */
  endsAt: string;
  now: Date;
}): CloseoutMoment {
  // Declined and withdrawn work is not his to close out; `completed` is,
  // because the studio marks that and the record can still be outstanding.
  if (!["accepted", "completed"].includes(input.status)) {
    return { due: false, reason: null };
  }
  const endsAt = Date.parse(input.endsAt);
  if (!Number.isFinite(endsAt) || endsAt > input.now.valueOf()) {
    return { due: false, reason: null };
  }
  if (input.closeoutStatus === "needs_changes") {
    return { due: true, reason: "needs_changes" };
  }
  if (crewCloseoutIsSubmitted(input.closeoutStatus)) {
    return { due: false, reason: null };
  }
  return { due: true, reason: "not_submitted" };
}
