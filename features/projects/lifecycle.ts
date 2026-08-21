import {
  journeyPhaseOrder,
  type JourneyPhase,
} from "@/features/journey/phases";

/**
 * Where a project state sits in the five arcs.
 *
 * The Jobs table names each job's state and gives it a tone, which answers
 * "is this one fine?" for one row at a time. It does not answer the
 * question a photographer actually opens the list with: what does my season
 * look like? Twelve rows of "Planning", "Booked" and "Ready for the day"
 * are three different moments wearing the same green, because all three are
 * genuinely *advancing* — the tone is right and uninformative.
 *
 * The arcs are the answer, and they are the same arcs the journey rail on
 * each job uses, so the list and the job can never disagree about where
 * something is.
 */
const phaseByState: Record<string, JourneyPhase> = {
  LEAD: "enquire",
  // The state machine says LEAD; some older copy says INQUIRY. Both mean
  // the same first moment.
  INQUIRY: "enquire",
  CONSULTATION: "enquire",

  PROPOSAL: "book",
  CONTRACT_PENDING: "book",
  RETAINER_PENDING: "book",
  BOOKED: "book",

  PLANNING: "prepare",

  READY: "the_day",
  EVENT_COMPLETE: "the_day",

  POST_PRODUCTION: "deliver",
  DELIVERED: "deliver",
  REVIEW_REQUESTED: "deliver",
  CLOSED: "deliver",
};

/**
 * The arc a state belongs to, or null.
 *
 * Cancelled and archived jobs are not at a point in the lifecycle — they
 * left it — and drawing them a progress track would claim otherwise. A
 * postponed job is the subtler case: it is somewhere in the arcs, but the
 * state alone no longer says where, and guessing would be worse than
 * drawing nothing.
 */
export function projectPhase(state: string): JourneyPhase | null {
  return phaseByState[state.trim().toUpperCase()] ?? null;
}

/**
 * How far through the arcs a state is, as a count of arcs reached.
 *
 * 1 for an inquiry, 5 for a delivered job, 0 for a job that has left the
 * lifecycle. Deliberately a count and not a percentage: a photographer
 * thinks "we're through booking", not "this job is 40% complete", and a
 * percentage on a wedding invites the reader to average things that should
 * never be averaged.
 */
export function projectPhaseIndex(state: string): number {
  const phase = projectPhase(state);
  return phase ? journeyPhaseOrder.indexOf(phase) + 1 : 0;
}
