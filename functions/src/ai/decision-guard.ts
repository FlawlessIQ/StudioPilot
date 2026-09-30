/**
 * Whether a decision on an AI action may run, given where the action stands.
 *
 * decideAiAction used to decide whatever it was handed. The browser mints a
 * fresh idempotency key per press, so the command-execution record never
 * caught a repeat — and approving a message draft twice rewrote its email job
 * as a fresh `queued` job, so the couple got the email twice. A second tab, a
 * double tap on Today, or a retry after a slow response was enough.
 *
 * - `proceed`: the action is still waiting on a person; decide it.
 * - `repeat`: the same decision again. Nothing re-runs; the caller answers
 *   with the prior result. (The rejection form uses this to add its reason.)
 * - `refuse`: a different decision on work already decided — AI_ACTION_ALREADY_DECIDED.
 *
 * Pure.
 */
export type DecisionGate = "proceed" | "repeat" | "refuse";

export function decisionGate(
  currentStatus: string,
  decision: "approved" | "rejected" | "dismissed",
): DecisionGate {
  if (currentStatus === "review_required") return "proceed";
  // A draft that failed, or is still being written, has sent nothing; putting
  // it away is always safe (the job's prepared tray dismisses these in bulk).
  if (
    decision === "dismissed" &&
    ["failed", "queued", "running"].includes(currentStatus)
  )
    return "proceed";
  if (currentStatus === decision) return "repeat";
  return "refuse";
}
