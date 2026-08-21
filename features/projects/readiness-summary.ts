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

/** Complete, or under a waiver that has not expired. */
function satisfied(
  checkpoint: ReadinessCheckpointRecord,
  now: Date,
): boolean {
  const status = text(checkpoint.status);
  if (status === "complete") return true;
  if (status !== "waived") return false;
  const expires = text(checkpoint.waiverExpiresAt);
  return !expires || new Date(expires) > now;
}

export function readinessSummary(
  checkpoints: readonly ReadinessCheckpointRecord[],
  now: Date = new Date(),
): ReadinessSummary {
  const required = checkpoints.filter(
    (checkpoint) => checkpoint.blocking === true,
  );
  if (required.length === 0)
    return { tracked: false, percent: 0, blocking: [] };

  const met = required.filter((checkpoint) => satisfied(checkpoint, now));
  return {
    tracked: true,
    percent: Math.round((met.length / required.length) * 100),
    blocking: required
      .filter((checkpoint) => !satisfied(checkpoint, now))
      .map((checkpoint) => text(checkpoint.name) || "Unnamed checkpoint"),
  };
}
