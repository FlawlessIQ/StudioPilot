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
