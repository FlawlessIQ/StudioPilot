import { finalDetailsLockApplies } from "@/features/job-kinds/job-kinds";
import { detailsLockOn, resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { isLiveConsultation } from "@/features/consultations/live";
import { isFinalDetailsCall } from "@/features/consultations/purpose";

/**
 * Where a job's final details call stands, for its journey step.
 *
 * The details lock (functions/src/planning/final-details.ts) sends the couple
 * a link to book it; booking makes a `consultations` record with
 * `purpose: "final_details"`. Null when the job has none: the studio turned
 * it off, or the job isn't a wedding (no lock, no call).
 */
export type FinalCallState = {
  state: "not_yet" | "invited" | "booked" | "held";
  lockOn: string | null;
  startsAt: string | null;
};

type Row = Record<string, unknown>;

export function finalCallState(input: {
  project: Row | null | undefined;
  planningTimeline: unknown;
  consultations: readonly Row[];
  /** YYYY-MM-DD */
  today: string;
  /** ISO, for "has it happened". */
  now: string;
}): FinalCallState | null {
  if (!input.project || !finalDetailsLockApplies(input.project)) return null;
  const timeline = resolvePlanningTimeline(input.planningTimeline);
  if (!timeline.finalCall) return null;
  const lockOn = detailsLockOn(String(input.project.eventDate ?? ""), timeline);
  const call = input.consultations
    .filter((record) => isFinalDetailsCall(record) && isLiveConsultation(record))
    .sort((left, right) => String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")))[0];
  if (call) {
    const startsAt = String(call.startsAt ?? "") || null;
    const held = call.status === "completed" || (startsAt !== null && startsAt <= input.now);
    return { state: held ? "held" : "booked", lockOn, startsAt };
  }
  if (lockOn && input.today >= lockOn) return { state: "invited", lockOn, startsAt: null };
  return { state: "not_yet", lockOn, startsAt: null };
}
