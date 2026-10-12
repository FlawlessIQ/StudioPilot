import { isLiveConsultation } from "@/features/consultations/live";
import { isWalkthrough } from "@/features/consultations/purpose";
import { callWhen } from "@/features/consultations/upcoming";

/**
 * Where a planner's venue walkthrough stands, for its journey step and the
 * job's walkthrough card (docs/planner-journey-plan.md, N5).
 *
 * The planner invites the couple from the job ("Invite them to book the
 * walkthrough"); booking makes a `consultations` record with
 * `purpose: "walkthrough"`. The job keeps when the invite went
 * (`walkthroughInvitedAt`, public-scheduling.ts) so "invited" is read from the
 * job itself, as a trial's is.
 */
export type WalkthroughState = {
  state: "not_booked" | "invited" | "booked" | "held";
  startsAt: string | null;
};

type Row = Record<string, unknown>;

/** The job's walkthrough that is on or happened, the latest first. */
export function currentWalkthrough<T extends Row>(consultations: readonly T[]): T | null {
  return (
    consultations
      .filter((record) => isWalkthrough(record) && isLiveConsultation(record))
      .sort((left, right) => String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")))[0] ?? null
  );
}

export function walkthroughState(input: {
  consultations: readonly Row[];
  project: Row | null | undefined;
  /** ISO, for "has it happened" and whether the invite is still open. */
  now: string;
}): WalkthroughState {
  const walk = currentWalkthrough(input.consultations);
  if (walk) {
    const startsAt = String(walk.startsAt ?? "") || null;
    const held = walk.status === "completed" || (startsAt !== null && startsAt <= input.now);
    return { state: held ? "held" : "booked", startsAt };
  }
  const invitedAt = typeof input.project?.walkthroughInvitedAt === "string" ? input.project.walkthroughInvitedAt : "";
  const closesAt = Date.parse(String(input.project?.walkthroughInviteExpiresAt ?? ""));
  if (invitedAt && (!Number.isFinite(closesAt) || closesAt > Date.parse(input.now))) return { state: "invited", startsAt: null };
  return { state: "not_booked", startsAt: null };
}

/** When it is, "Wed, Oct 14 at 10:00 AM", on the job's clock; null when none is booked. */
export function walkthroughWhen(input: { consultations: readonly Row[]; timeZone?: string | null }): string | null {
  const walk = currentWalkthrough(input.consultations);
  if (!walk || typeof walk.startsAt !== "string" || !walk.startsAt) return null;
  return callWhen({ ...walk, timezone: input.timeZone || walk.timezone }) || null;
}
