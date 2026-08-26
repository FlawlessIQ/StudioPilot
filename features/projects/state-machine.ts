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

/**
 * Where booking a consultation takes a project on its own.
 *
 * The walk of 2026-08-26 found the lifecycle stopped dead here. Booking a
 * consultation on StudioCue's own calendar — with a Zoom link StudioCue
 * created — ticked the journey's "Consultation" step but left the project at
 * `LEAD`. The booking workspace then refused the consultation notes with
 * "This project is still marked as a lead", and the only way forward was the
 * manual stage control, whose own description says it is for steps that
 * happened *outside* StudioCue.
 *
 * So the booking now carries the transition itself. Deliberately NOT added to
 * `evidenceControlledProjectTransitions`: that list makes evidence the *only*
 * authority, and a consultation held over the phone is a real thing a
 * photographer must still be able to record by hand. This says the evidence is
 * *sufficient*, not that it is required.
 *
 * Returns null for any other state, so a consultation booked later in the job
 * — a planning call on a booked wedding — never drags the project backwards.
 */
export function consultationBookingAdvancesTo(
  from: ProjectState,
): ProjectState | null {
  if (from !== "LEAD") return null;
  return canTransition(from, "CONSULTATION") ? "CONSULTATION" : null;
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
