/**
 * The booking brief a page should show, now that a brief can be prepared
 * again from changed notes (functions/src/booking/brief-rerun.ts).
 *
 * Each preparation is a numbered run; the consultation's `briefRun` names the
 * current one, and the earlier run's open actions are `superseded`. The
 * booking page found its three actions by capability alone, which after a
 * rerun would have picked whichever came back first from the query — often
 * the old brief, set aside a moment ago.
 *
 * Pure.
 */

type Row = Record<string, unknown> & { id: string };

const run = (value: unknown): number => {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
};

/** The current run's summary, package suggestion and proposal draft, if written. */
export function currentBriefActions(
  actions: readonly Row[],
  consultation: Record<string, unknown> | null,
) {
  const current = run(consultation?.briefRun);
  const live = actions.filter(
    (action) => action.status !== "superseded" && run(action.briefRun) === current,
  );
  const find = (capability: string) => live.find((action) => action.capability === capability);
  return {
    briefRun: current,
    summary: find("consultation_summary"),
    package: find("package_recommendation"),
    proposal: find("proposal_draft"),
  };
}

/** Mirrors the server's refusal so the button is not offered where it would fail. */
export function briefRerunBlocked(input: {
  consultationStatus: string;
  projectState: string;
  proposalStatuses: readonly string[];
}): string | null {
  if (input.proposalStatuses.some((status) => ["sent", "viewed", "accepted"].includes(status)))
    return "A proposal has already gone to the couple, so the brief no longer decides anything. Change the proposal instead.";
  if (input.projectState !== "CONSULTATION")
    return ["LEAD", "LOST"].includes(input.projectState)
      ? "The brief is prepared once the job is at the consultation stage."
      : "This job has moved on to its proposal, so the brief no longer decides anything. Change the proposal instead.";
  if (input.consultationStatus !== "completed")
    return "Write up the consultation first — the brief is prepared from its notes.";
  return null;
}
