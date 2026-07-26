import type { ProjectState } from "./schema";

export const allowedProjectTransitions: Readonly<
  Record<ProjectState, readonly ProjectState[]>
> = {
  LEAD: ["CONSULTATION", "CANCELLED", "ARCHIVED"],
  CONSULTATION: ["PROPOSAL", "CANCELLED", "POSTPONED"],
  PROPOSAL: ["CONTRACT_PENDING", "CANCELLED", "POSTPONED"],
  CONTRACT_PENDING: ["RETAINER_PENDING", "CANCELLED", "POSTPONED"],
  RETAINER_PENDING: ["BOOKED", "CANCELLED", "POSTPONED"],
  BOOKED: ["PLANNING", "CANCELLED", "POSTPONED"],
  PLANNING: ["READY", "CANCELLED", "POSTPONED"],
  READY: ["EVENT_COMPLETE", "PLANNING", "CANCELLED", "POSTPONED"],
  EVENT_COMPLETE: ["POST_PRODUCTION"],
  POST_PRODUCTION: ["DELIVERED"],
  DELIVERED: ["REVIEW_REQUESTED", "CLOSED"],
  REVIEW_REQUESTED: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  CANCELLED: ["ARCHIVED"],
  POSTPONED: ["CONSULTATION", "BOOKED", "PLANNING", "CANCELLED"],
  ARCHIVED: [],
};

export function canTransition(from: ProjectState, to: ProjectState): boolean {
  return allowedProjectTransitions[from].includes(to);
}

export function assertProjectTransition(from: ProjectState, to: ProjectState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Project transition ${from} → ${to} is not allowed.`);
  }
}
