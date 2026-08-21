/**
 * Project states that count as "in flight" for dashboard surfaces.
 *
 * Shared so the dashboard hero, the priority signals, and any later panel
 * agree on what "active" means. Terminal states (ARCHIVED, CANCELLED,
 * CLOSED, POSTPONED) are deliberately excluded.
 *
 * LEAD is emphatically not terminal. It is where a job lands the moment an
 * inquiry is converted, still owing the couple a first reply — leaving it
 * out meant a photographer converted a lead and watched the job disappear
 * from Today until somebody advanced it by hand.
 */
export const activeProjectStates: ReadonlySet<string> = new Set([
  "LEAD",
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
