/**
 * How far a job has got, for screens that need to ask.
 *
 * Several surfaces kept their own hand-written list of "states past the
 * proposal", and the lists drifted. The booking workspace's copy omitted
 * `CONSULTATION`, so a consultation marked as handled over the phone landed on
 * "Schedule the consultation first" — and it omitted `POSTPONED`, so a wedding
 * moved to next year was told the same thing, on a job whose contract and
 * retainer were already on file.
 *
 * A held job has not gone backwards. It stopped where it stopped, and the
 * paperwork behind it still exists — so `POSTPONED` is treated as at least
 * booked, which is the earliest state it can be reached from in practice.
 */

const RANK: Record<string, number> = {
  LEAD: 0,
  CONSULTATION: 1,
  PROPOSAL: 2,
  CONTRACT_PENDING: 3,
  RETAINER_PENDING: 4,
  BOOKED: 5,
  PLANNING: 6,
  READY: 7,
  EVENT_COMPLETE: 8,
  POST_PRODUCTION: 9,
  DELIVERED: 10,
  REVIEW_REQUESTED: 11,
  CLOSED: 12,
  ARCHIVED: 13,
  // A hold keeps whatever the job had. Ranking it below BOOKED would ask a
  // studio to re-do steps they have already done.
  POSTPONED: 5,
  // Cancelled deliberately keeps its rank rather than dropping to zero: the
  // records are still on file and screens should read them as they were.
  CANCELLED: 5,
};

export function stageRank(state: string): number {
  return RANK[state] ?? 0;
}

export function stageAtLeast(state: string, floor: string): boolean {
  return stageRank(state) >= stageRank(floor);
}

/** Past the point where the consultation flow is the studio's next move. */
export function pastConsultation(state: string): boolean {
  return stageAtLeast(state, "CONSULTATION");
}

/** Past the point where a proposal is the studio's next move. */
export function pastProposal(state: string): boolean {
  return stageAtLeast(state, "PROPOSAL");
}
