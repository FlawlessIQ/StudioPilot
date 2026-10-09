import { finalDetailsLockApplies } from "@/features/job-kinds/job-kinds";
import { detailsLockOn, resolvePlanningTimeline } from "@/features/planning/planning-timeline";

/**
 * Where a per-person client's final headcount stands (makeup, hair; trades.ts
 * `perPersonPricing`), in the shape the journey's final step reads
 * (features/journey/steps.ts `finalCall`, which titles it "Final headcount").
 *
 * There is no call to book. When the details lock, the client is asked
 * "still this many getting ready?" and confirms in one tap
 * (functions/src/planning/final-details.ts opens a `kind: "headcount"`
 * sign-off; server/planning/final-details.ts records the tap). Confirmed is
 * "held", which the step shows as Confirmed. Unlike the final details call it
 * does not wait on the studio's call setting: the headcount is asked whenever
 * the details lock. Null when the job has no lock (job-kinds.ts).
 */
export type FinalHeadcountState = {
  state: "not_yet" | "invited" | "held";
  lockOn: string | null;
  startsAt: null;
};

type Row = Record<string, unknown>;

export function finalHeadcountState(input: {
  project: Row | null | undefined;
  planningTimeline: unknown;
  /** The job's `detailSignoffs` record, if the lock has opened one. */
  signoff: Row | null | undefined;
  /** YYYY-MM-DD */
  today: string;
}): FinalHeadcountState | null {
  if (!input.project || !finalDetailsLockApplies(input.project)) return null;
  const lockOn = detailsLockOn(String(input.project.eventDate ?? ""), resolvePlanningTimeline(input.planningTimeline));
  if (input.signoff?.status === "confirmed") return { state: "held", lockOn, startsAt: null };
  if (input.signoff || (lockOn && input.today >= lockOn)) return { state: "invited", lockOn, startsAt: null };
  return { state: "not_yet", lockOn, startsAt: null };
}
