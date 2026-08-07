/**
 * Project states that count as "in flight" for dashboard surfaces.
 *
 * Shared so the dashboard hero, the priority signals, and any later panel
 * agree on what "active" means. Terminal states (ARCHIVED, CANCELLED,
 * CLOSED, POSTPONED, LEAD) are deliberately excluded.
 */
export const activeProjectStates: ReadonlySet<string> = new Set([
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
]);
