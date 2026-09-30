/**
 * Putting a job on hold, or calling it off.
 *
 * The state machine has allowed `POSTPONED` and `CANCELLED` from nearly every
 * live state since the beginning, and `transitionProject` permits both — they
 * are not evidence-controlled. Nothing in the product could reach either. The
 * only mentions of those states in the UI were filters *excluding* them, so a
 * wedding moved to next year, or a couple who called it off, left a job sitting
 * at "Ready for the day" forever: counted in the month's events, listed in
 * Today, and outstanding on every report.
 *
 * Both are ordinary in this business and neither is a failure of the studio, so
 * they are offered plainly and with a reason recorded. A hold is reversible, so
 * the way back matters as much as the way in.
 */

import { allowedProjectTransitions } from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";
import {
  heldAfterBooking,
  holdResumeStates,
  type HoldRecord,
} from "@/features/projects/hold-resume";

export type Interruption = "POSTPONED" | "CANCELLED";

/** The shortest reason worth keeping in an audit log. */
export const MINIMUM_INTERRUPTION_REASON = 10;

export function interruptionReasonIsUsable(reason: string): boolean {
  return reason.trim().length >= MINIMUM_INTERRUPTION_REASON;
}

/**
 * Whether a job in this state can be held or called off.
 *
 * Read from the state machine rather than restated, so a change there cannot
 * leave this offering a move the command will refuse.
 */
export function interruptionsFor(state: ProjectState): Interruption[] {
  const allowed = allowedProjectTransitions[state] ?? [];
  return (["POSTPONED", "CANCELLED"] as const).filter((candidate) =>
    allowed.includes(candidate),
  );
}

export const INTERRUPTION_COPY: Record<
  Interruption,
  { label: string; prompt: string; detail: string }
> = {
  POSTPONED: {
    label: "Put the job on hold",
    prompt: "Why is it on hold?",
    detail:
      "The job stops appearing as live work. Everything on it is kept, and you can bring it back when the new date is settled.",
  },
  CANCELLED: {
    label: "Cancel the job",
    prompt: "Why was it cancelled?",
    detail:
      "The job stops appearing as live work and stays on file. Nothing is deleted, and the contract, payments and delivery records are preserved.",
  },
};

/**
 * Where a held job goes when it comes back.
 *
 * A job held after it was booked comes back through BOOKED: the signature and
 * the retainer are already on file and the booking gate re-checks them against
 * the new date. A job held before it was booked comes back to the stage it
 * left — it has no signature and no retainer for the gate to find, and
 * offering BOOKED (or, worse, PLANNING) is how a job at PROPOSAL got into
 * planning unsigned and unpaid (money audit, 2026-09-30). See hold-resume.ts.
 */
export function resumeTargetFor(
  state: ProjectState,
  hold: HoldRecord = {},
): ProjectState | null {
  if (state !== "POSTPONED") return null;
  const from = String(hold.postponedFromState ?? "");
  // A hold recorded before `postponedFromState` existed, on a job with no
  // booking stamp, still offers the booking check: the gate refuses it if
  // nothing is on file, which is honest, where guessing a stage is not.
  const resolved: ProjectState =
    !heldAfterBooking(hold) && holdResumeStates(hold).includes(from)
      ? (from as ProjectState)
      : "BOOKED";
  return allowedProjectTransitions.POSTPONED.includes(resolved) ? resolved : null;
}
