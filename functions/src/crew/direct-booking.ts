/**
 * What booking someone directly does to the job's crew (crew/commands.ts,
 * `assignDirectly`). Pure, so the rules are tested on their own
 * (tests/crew-direct-booking.test.ts).
 *
 * Conor, 2026-10-09: "I need to be able to manually set someone as working
 * the job — if I can't wait for an answer, or I have full-time staff who take
 * whatever work I give them." The studio's say-so is the booking:
 * - someone already booked on this job is refused (no double booking);
 * - an offer already out to the same person becomes their booking, rather
 *   than a second assignment beside it;
 * - an offer chain still running for the same role is filled by it, and
 *   whoever that chain was waiting on is told the role has gone, so nobody
 *   accepts a job that no longer exists.
 */

export type JobAssignment = { id: string; crewProfileId: string; status: string; role: string };
export type JobCascade = { id: string; role: string; status: string; currentAssignmentId: string | null };

export type DirectBookingPlan =
  | { ok: false; code: "CREW_ALREADY_BOOKED" }
  | {
      ok: true;
      /** An open offer to this same person, booked in place. */
      reuseAssignmentId: string | null;
      /** Offer chains for this role that this booking fills. */
      fillCascadeIds: string[];
      /** Offers still waiting on someone else in those chains, now withdrawn. */
      releaseAssignmentIds: string[];
    };

const OPEN_OFFER = new Set(["invited", "viewed"]);
const sameRole = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase();

export function directBookingPlan(input: {
  crewProfileId: string;
  role: string;
  assignments: JobAssignment[];
  cascades: JobCascade[];
}): DirectBookingPlan {
  const theirs = input.assignments.filter((assignment) => assignment.crewProfileId === input.crewProfileId);
  if (theirs.some((assignment) => assignment.status === "accepted")) return { ok: false, code: "CREW_ALREADY_BOOKED" };
  const openOffer = theirs.find((assignment) => OPEN_OFFER.has(assignment.status)) ?? null;
  const fill = input.cascades.filter(
    (cascade) =>
      cascade.status === "active" &&
      (sameRole(cascade.role, input.role) || (openOffer !== null && cascade.currentAssignmentId === openOffer.id)),
  );
  const byId = new Map(input.assignments.map((assignment) => [assignment.id, assignment]));
  const release = fill
    .map((cascade) => cascade.currentAssignmentId)
    .filter((id): id is string => Boolean(id) && id !== openOffer?.id)
    .filter((id) => OPEN_OFFER.has(byId.get(id)?.status ?? ""));
  return {
    ok: true,
    reuseAssignmentId: openOffer?.id ?? null,
    fillCascadeIds: fill.map((cascade) => cascade.id),
    releaseAssignmentIds: [...new Set(release)],
  };
}
