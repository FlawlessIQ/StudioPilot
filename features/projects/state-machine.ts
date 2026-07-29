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

export const evidenceControlledProjectTransitions: ReadonlyArray<{
  from: ProjectState;
  to: ProjectState;
  authority: "proposal" | "docusign" | "booking_gate" | "readiness" | "delivery";
}> = [
  { from: "PROPOSAL", to: "CONTRACT_PENDING", authority: "proposal" },
  {
    from: "CONTRACT_PENDING",
    to: "RETAINER_PENDING",
    authority: "docusign",
  },
  { from: "RETAINER_PENDING", to: "BOOKED", authority: "booking_gate" },
  { from: "POSTPONED", to: "BOOKED", authority: "booking_gate" },
  { from: "PLANNING", to: "READY", authority: "readiness" },
  { from: "POST_PRODUCTION", to: "DELIVERED", authority: "delivery" },
];

export function transitionAuthority(
  from: ProjectState,
  to: ProjectState,
): (typeof evidenceControlledProjectTransitions)[number]["authority"] | null {
  return (
    evidenceControlledProjectTransitions.find(
      (transition) => transition.from === from && transition.to === to,
    )?.authority ?? null
  );
}

export function assertManualProjectTransition(
  from: ProjectState,
  to: ProjectState,
): void {
  assertProjectTransition(from, to);
  const authority = transitionAuthority(from, to);
  if (authority) {
    throw new Error(
      `Project transition ${from} → ${to} requires ${authority.replaceAll("_", " ")} evidence.`,
    );
  }
}
