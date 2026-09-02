/**
 * Readiness, for display, from the checkpoints that explain it.
 *
 * The job page used to take its percentage from `project.readinessScore` — a
 * server-written field — while the sentence beside it was decided by whether
 * any checkpoints had loaded. The two disagreed constantly: the header read
 * "—  readiness tracking starts once planning begins" while the footer of the
 * same page read "68% ready".
 *
 * A number nobody can explain is worse than no number, so this derives the
 * score from the checkpoints themselves, using the same rule as
 * `calculateReadiness`: blocking checkpoints satisfied over blocking
 * checkpoints total, where "satisfied" means complete or actively waived.
 * `tracked` is false when nothing required exists yet — which is a real and
 * common state for a job that has not reached planning, and should be said
 * rather than scored.
 *
 * Pure function, no I/O. tests/readiness-summary.test.ts pins it against
 * calculateReadiness so the two can never drift.
 */

import {
  checkpointSatisfiedByEvidence,
  noReadinessEvidence,
  type ReadinessEvidence,
} from "@/features/readiness/checkpoint-evidence";

export type ReadinessCheckpointRecord = Record<string, unknown>;

export type ReadinessSummary = {
  /** False when no required checkpoint exists — say so, do not score it. */
  tracked: boolean;
  /** 0–100. Meaningless, and not to be shown, when `tracked` is false. */
  percent: number;
  /** Names of required checkpoints that are not satisfied. */
  blocking: string[];
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Complete, under a waiver that has not expired, or already proven by the
 * project's own records.
 *
 * The third clause is the one the walk of 2026-08-26 was missing: checkpoints
 * are only completed by workflow automation, so a job whose contract, retainer,
 * questionnaire, run of show and crew were all done still read 0% ready with
 * those five listed as blockers. See features/readiness/checkpoint-evidence.ts.
 */
function satisfied(
  checkpoint: ReadinessCheckpointRecord,
  now: Date,
  evidence: ReadinessEvidence,
): boolean {
  const status = text(checkpoint.status);
  if (status === "complete") return true;
  if (status === "waived") {
    const expires = text(checkpoint.waiverExpiresAt);
    return !expires || new Date(expires) > now;
  }
  // A failed checkpoint is a decision someone recorded, not a gap in the
  // records, so evidence does not overturn it.
  if (status === "failed") return false;
  return checkpointSatisfiedByEvidence(checkpoint, evidence);
}

export function readinessSummary(
  checkpoints: readonly ReadinessCheckpointRecord[],
  now: Date = new Date(),
  evidence: ReadinessEvidence = noReadinessEvidence,
): ReadinessSummary {
  const required = checkpoints.filter(
    (checkpoint) => checkpoint.blocking === true,
  );
  if (required.length === 0)
    return { tracked: false, percent: 0, blocking: [] };

  const met = required.filter((checkpoint) =>
    satisfied(checkpoint, now, evidence),
  );
  return {
    tracked: true,
    percent: Math.round((met.length / required.length) * 100),
    /**
     * Soonest due first, because the caller shows the head of this list.
     *
     * It was template order, so "8 blockers: **Final balance paid** +7 more"
     * headlined a wedding nine months out with the one item that should worry
     * nobody — a client payment not due until a fortnight before the day, and
     * correctly outstanding. The item chosen to stand for the eight was the
     * least actionable of them.
     *
     * Undated ones sort last: a requirement with no date is not more urgent
     * than one with a date this month.
     */
    blocking: required
      .filter((checkpoint) => !satisfied(checkpoint, now, evidence))
      .slice()
      .sort((left, right) =>
        (text(left.resolvedDueDate) || "9999-12-31").localeCompare(
          text(right.resolvedDueDate) || "9999-12-31",
        ),
      )
      .map((checkpoint) => text(checkpoint.name) || "Unnamed checkpoint"),
  };
}
