import { isLiveConsultation } from "@/features/consultations/live";
import { isTrial } from "@/features/consultations/purpose";

/**
 * Where a job's makeup or hair trial stands, for its journey step
 * (docs/vendor-journeys-plan.md, 3.2).
 *
 * The studio sends the client a link from the job ("Invite them to book the
 * trial"); booking makes a `consultations` record with `purpose: "trial"`.
 * It can come before the agreement or after it — both happen — so nothing
 * waits on it, and nothing is held up by a bride who didn't want one.
 */
export type TrialState = {
  state: "not_booked" | "booked" | "held";
  startsAt: string | null;
};

type Row = Record<string, unknown>;

export function trialState(input: {
  consultations: readonly Row[];
  /** ISO, for "has it happened". */
  now: string;
}): TrialState {
  const trial = input.consultations
    .filter((record) => isTrial(record) && isLiveConsultation(record))
    .sort((left, right) => String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")))[0];
  if (!trial) return { state: "not_booked", startsAt: null };
  const startsAt = String(trial.startsAt ?? "") || null;
  const held = trial.status === "completed" || (startsAt !== null && startsAt <= input.now);
  return { state: held ? "held" : "booked", startsAt };
}
