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
 * Pure function, no I/O. The scoring itself now lives in
 * features/readiness/score.ts and is shared with both engines — this used to
 * carry its own copy, and the test that claimed to pin it against
 * `calculateReadiness` pinned it against the *app-side* engine while the
 * server's, which writes the number every list displays, drifted unchecked.
 */

import {
  noReadinessEvidence,
  type ReadinessEvidence,
} from "@/features/readiness/checkpoint-evidence";
import {
  checkpointIsRequired,
  checkpointIsSatisfied,
  readinessScore,
} from "@/features/readiness/score";

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

export function readinessSummary(
  checkpoints: readonly ReadinessCheckpointRecord[],
  now: Date = new Date(),
  evidence: ReadinessEvidence = noReadinessEvidence,
): ReadinessSummary {
  // One definition of the score, shared with the readiness engine and the
  // server that writes `project.readinessScore`. See features/readiness/score.ts.
  const score = readinessScore(checkpoints, now.toISOString(), evidence);
  if (!score.tracked) return { tracked: false, percent: 0, blocking: [] };

  const required = checkpoints.filter(checkpointIsRequired);
  return {
    tracked: true,
    percent: score.percent,
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
      .filter(
        (checkpoint) =>
          !checkpointIsSatisfied(checkpoint, now.toISOString(), evidence),
      )
      .slice()
      .sort((left, right) =>
        (text(left.resolvedDueDate) || "9999-12-31").localeCompare(
          text(right.resolvedDueDate) || "9999-12-31",
        ),
      )
      .map((checkpoint) => text(checkpoint.name) || "Unnamed checkpoint"),
  };
}
