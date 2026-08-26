/**
 * Project states, in the words a photographer uses.
 *
 * The state machine's vocabulary is deliberately precise — CONTRACT_PENDING,
 * POST_PRODUCTION, REVIEW_REQUESTED — and that precision belongs in the
 * engine, the audit log and the API. It does not belong on a chip beside a
 * couple's names, where "RETAINER PENDING" reads as a system status rather
 * than "they haven't paid the deposit yet".
 *
 * Pure lookup, no I/O.
 */

const LABELS: Record<string, string> = {
  INQUIRY: "New inquiry",
  CONSULTATION: "Talking",
  PROPOSAL: "Proposal out",
  CONTRACT_PENDING: "Awaiting signature",
  RETAINER_PENDING: "Awaiting deposit",
  BOOKED: "Booked",
  PLANNING: "Planning",
  READY: "Ready for the day",
  EVENT_COMPLETE: "Shot",
  POST_PRODUCTION: "Editing",
  DELIVERED: "Delivered",
  REVIEW_REQUESTED: "Review asked",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
  ARCHIVED: "Archived",
};

/** The plain-English name of a project state. */
export function projectStateLabel(state: string): string {
  return (
    LABELS[state] ??
    state
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^\w/, (letter) => letter.toUpperCase())
  );
}

/**
 * The button label for manually advancing a project into a state.
 *
 * `projectStateLabel` returns the *name* of a state — "Shot", "Proposal out",
 * "Awaiting deposit". Those read correctly on a chip beside a couple's name and
 * badly after a verb: the stage control rendered `Confirm ${label}`, producing
 * "Confirm Shot" on a wedding that had happened and "Confirm Proposal out" on a
 * new job. Neither is a sentence a photographer would say.
 *
 * So each state also names the *event* that moved the job into it, because that
 * is what the operator is confirming happened outside StudioCue.
 *
 * Pure lookup, no I/O.
 */
const ADVANCE_ACTIONS: Record<string, string> = {
  INQUIRY: "Confirm the inquiry arrived",
  CONSULTATION: "Confirm we've spoken",
  PROPOSAL: "Confirm the proposal went out",
  CONTRACT_PENDING: "Confirm the contract is sent",
  RETAINER_PENDING: "Confirm the contract is signed",
  BOOKED: "Confirm the deposit is paid",
  PLANNING: "Confirm planning has started",
  READY: "Confirm they're ready for the day",
  EVENT_COMPLETE: "Confirm the event happened",
  POST_PRODUCTION: "Confirm editing has started",
  DELIVERED: "Confirm the gallery is delivered",
  REVIEW_REQUESTED: "Confirm the review was asked for",
  CLOSED: "Confirm the job is closed",
  CANCELLED: "Confirm the job is cancelled",
  ARCHIVED: "Confirm the job is archived",
};

/**
 * What the "move this project forward" button should say.
 *
 * Falls back to "Move to <plain name>" rather than "Confirm <name>" so an
 * unmapped state still reads as an instruction instead of a fragment.
 */
export function projectStateAdvanceAction(state: string): string {
  return ADVANCE_ACTIONS[state] ?? `Move to ${projectStateLabel(state)}`;
}
