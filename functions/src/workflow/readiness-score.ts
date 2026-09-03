/**
 * The functions copy of readiness scoring.
 *
 * features/readiness/score.ts is the source of truth and carries the reasoning
 * for why this exists at all. functions/ is a separate package with no
 * "@/features" path, so the file is duplicated the way
 * checkpoint-evidence.ts and starter-templates.ts are, and
 * tests/readiness-one-truth.test.ts fails if the two drift.
 *
 * Everything below the marker is byte-identical to the source. Edit that file,
 * then copy it down.
 */

import {
  checkpointSatisfiedByEvidence,
  noReadinessEvidence,
  type ReadinessEvidence,
} from "./checkpoint-evidence.js";

/**
 * The fields scoring reads. Structural on purpose: a Firestore document, a
 * parsed `Checkpoint` and a loosely-typed record all satisfy it, so the three
 * callers need no conversion layer between them and this.
 */
export type ScorableCheckpoint = {
  status?: unknown;
  blocking?: unknown;
  waiverExpiresAt?: unknown;
  completionMethod?: unknown;
  templateKey?: unknown;
};

export type ReadinessScore = {
  /**
   * False when nothing is required yet, which is a real and common state for a
   * job that has not reached planning. Callers must render an absence, not a
   * zero — a job with no requirements is not a job that has failed all of them.
   */
  tracked: boolean;
  /** 0–100. Meaningless, and not to be shown, when `tracked` is false. */
  percent: number;
  totalRequired: number;
  satisfiedRequired: number;
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Counted in the denominator. Strict, because the schema guarantees boolean. */
export function checkpointIsRequired(checkpoint: ScorableCheckpoint): boolean {
  return checkpoint.blocking === true;
}

/**
 * Complete, under a waiver that has not expired, or already proven by the
 * project's own records.
 *
 * The third clause is the one that was missing everywhere until 2026-08-26:
 * checkpoints are only ever completed by workflow automation, so a job whose
 * contract, retainer, questionnaire, run of show and crew were all done still
 * read 0% ready with those five listed as blockers. See
 * features/readiness/checkpoint-evidence.ts for the rules it defers to.
 *
 * `now` is an ISO timestamp rather than a `Date` so that both sides of the
 * mirror compare the same way; the waiver expiry is parsed rather than string
 * compared, because a date-only expiry and a full timestamp are both written
 * in practice and lexical comparison gets those wrong.
 */
export function checkpointIsSatisfied(
  checkpoint: ScorableCheckpoint,
  now: string,
  evidence: ReadinessEvidence = noReadinessEvidence,
): boolean {
  const status = text(checkpoint.status);
  if (status === "complete") return true;
  if (status === "waived") {
    const expires = text(checkpoint.waiverExpiresAt);
    if (!expires) return true;
    const expiresAt = Date.parse(expires);
    const at = Date.parse(now);
    // An unreadable expiry is not evidence that a waiver still holds.
    if (!Number.isFinite(expiresAt) || !Number.isFinite(at)) return false;
    return expiresAt > at;
  }
  // A failed checkpoint is a decision someone recorded, not a gap in the
  // records, so evidence does not overturn it.
  if (status === "failed") return false;
  return checkpointSatisfiedByEvidence(
    {
      completionMethod: text(checkpoint.completionMethod),
      templateKey: text(checkpoint.templateKey),
    },
    evidence,
  );
}

export function readinessScore(
  checkpoints: readonly ScorableCheckpoint[],
  now: string,
  evidence: ReadinessEvidence = noReadinessEvidence,
): ReadinessScore {
  const required = checkpoints.filter(checkpointIsRequired);
  if (required.length === 0)
    return { tracked: false, percent: 0, totalRequired: 0, satisfiedRequired: 0 };
  const satisfied = required.filter((checkpoint) =>
    checkpointIsSatisfied(checkpoint, now, evidence),
  );
  return {
    tracked: true,
    percent: Math.round((satisfied.length / required.length) * 100),
    totalRequired: required.length,
    satisfiedRequired: satisfied.length,
  };
}
