/**
 * Taking one person off a job that is still going ahead.
 *
 * Only a job stopping ever ended an assignment (./job-stopped.ts). A studio
 * whose second shooter broke a wrist, or who hired the wrong videographer,
 * had no way to end that one booking: the crew member could not back out once
 * they had accepted, and archiving them from the directory was refused with
 * CREW_HAS_OPEN_ASSIGNMENT and nothing on screen to clear it. GR Productions
 * was about to staff its first wedding with exactly that gap.
 *
 * Withdrawal follows the job-stopped rule for who is told — someone who
 * accepted is emailed, someone who never answered is withdrawn quietly — and
 * decides what happens to the cascade that made the offer. "Replace" is the
 * same withdrawal with the cascade moving on to the next person on the
 * studio's own ranked list, exactly as a decline would.
 *
 * Pure and deterministic. The functions copy: features/crew/withdraw.ts is
 * the source of truth, and tests/wave1-crew.test.ts keeps the two identical.
 */
import { dispositionFor } from "./job-stopped.js";

export type WithdrawalCascade = {
  status: string;
  currentAssignmentId: string | null;
  acceptedAssignmentId: string | null;
  currentCandidateIndex: number;
  candidateIds: readonly string[];
};

export type WithdrawalPlan =
  | { withdrawable: false; code: "ASSIGNMENT_NOT_WITHDRAWABLE" }
  | {
      withdrawable: true;
      /** Only somebody who accepted is holding the date, so only they are told. */
      notify: boolean;
      cascade:
        /** No cascade made this offer, or it has moved on from it. */
        | { action: "none" }
        /** Stop it: nobody else is asked for this slot. */
        | { action: "close" }
        /**
         * Ask the next people on the list, in order; the first one still on
         * the roster gets the offer. `fromIndex` is the first of them.
         */
        | { action: "advance"; fromIndex: number; candidateIds: string[] };
    };

export function withdrawalPlan(input: {
  assignmentId: string;
  status: string;
  replace: boolean;
  cascade: WithdrawalCascade | null;
}): WithdrawalPlan {
  // Same line as a job stopping: declined, expired, cancelled and completed
  // work is already over and there is nothing to withdraw.
  const disposition = dispositionFor({
    reason: "cancelled",
    status: input.status,
  });
  if (disposition.action !== "withdraw")
    return { withdrawable: false, code: "ASSIGNMENT_NOT_WITHDRAWABLE" };
  const cascade = input.cascade;
  // The cascade only speaks for this slot while this assignment is its
  // current offer or its accepted one; an older offer it has moved past is
  // not the cascade's to reopen.
  const drivesThisSlot =
    cascade !== null &&
    ((cascade.status === "active" &&
      cascade.currentAssignmentId === input.assignmentId) ||
      (cascade.status === "filled" &&
        cascade.acceptedAssignmentId === input.assignmentId));
  if (!drivesThisSlot)
    return {
      withdrawable: true,
      notify: disposition.notify,
      cascade: { action: "none" },
    };
  const fromIndex = cascade.currentCandidateIndex + 1;
  const remaining = cascade.candidateIds.slice(fromIndex);
  return {
    withdrawable: true,
    notify: disposition.notify,
    cascade:
      input.replace && remaining.length
        ? { action: "advance", fromIndex, candidateIds: [...remaining] }
        : { action: "close" },
  };
}
