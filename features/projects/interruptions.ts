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
 * BOOKED, because the signature and the retainer are already on file and the
 * booking gate re-checks them against the new date. The state machine also
 * allows CONSULTATION and PLANNING from here; neither is the common case, and
 * offering three choices where one is right is how a photographer ends up in
 * PLANNING on a job that was never re-booked.
 */
export function resumeTargetFor(state: ProjectState): ProjectState | null {
  if (state !== "POSTPONED") return null;
  return allowedProjectTransitions.POSTPONED.includes("BOOKED")
    ? "BOOKED"
    : null;
}
