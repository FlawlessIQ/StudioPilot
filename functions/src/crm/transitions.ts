/**
 * The project state machine, the functions copy.
 *
 * features/projects/state-machine.ts is the source of truth. functions/ is a
 * separate package with no "@/features" path, so the table is duplicated here
 * — it used to live inline in crm/commands.ts, where nothing could import it
 * to check it. tests/wave3-job-back.test.ts compares the two tables, the
 * routing and the undo-a-cancel rule move by move.
 *
 * Pure.
 */

export const projectStates = [
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
  "CLOSED",
  "CANCELLED",
  "POSTPONED",
  "ARCHIVED",
  "LOST",
] as const;

export type ProjectStateName = (typeof projectStates)[number];

export const transitions: Readonly<Record<ProjectStateName, readonly ProjectStateName[]>> = {
  LEAD: ["CONSULTATION", "CANCELLED", "ARCHIVED", "LOST"],
  CONSULTATION: ["PROPOSAL", "CANCELLED", "POSTPONED", "LOST"],
  PROPOSAL: ["CONTRACT_PENDING", "CANCELLED", "POSTPONED", "LOST"],
  // Back to PROPOSAL when the couple changes what they're booking before the
  // agreement goes out: they accept a revised proposal (proposals.ts
  // "revise_packages"). By hand, only once no agreement is out (crm/commands.ts).
  CONTRACT_PENDING: ["RETAINER_PENDING", "PROPOSAL", "CANCELLED", "POSTPONED", "LOST"],
  RETAINER_PENDING: ["BOOKED", "CANCELLED", "POSTPONED", "LOST"],
  // EVENT_COMPLETE from BOOKED and PLANNING, not only from READY: weddings
  // happen whether or not the checkboxes were ticked. See the features copy.
  BOOKED: ["PLANNING", "EVENT_COMPLETE", "CANCELLED", "POSTPONED"],
  PLANNING: ["READY", "EVENT_COMPLETE", "CANCELLED", "POSTPONED"],
  READY: ["EVENT_COMPLETE", "PLANNING", "CANCELLED", "POSTPONED"],
  EVENT_COMPLETE: ["POST_PRODUCTION"],
  POST_PRODUCTION: ["DELIVERED"],
  // Reopened for a re-edit, or a closed job reopened: `reopenJob`.
  DELIVERED: ["REVIEW_REQUESTED", "CLOSED", "POST_PRODUCTION"],
  REVIEW_REQUESTED: ["CLOSED", "POST_PRODUCTION"],
  CLOSED: ["ARCHIVED", "DELIVERED"],
  // A cancel undone goes back where it came from: `uncancelProject`.
  CANCELLED: ["ARCHIVED", "LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "READY"],
  // Back to where it was held from — see hold-resume.ts, which narrows this
  // to the one stage a given hold may return to.
  POSTPONED: ["CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED", "PLANNING", "CANCELLED"],
  ARCHIVED: [],
  // Reopened to where it closed from, or put away.
  LOST: ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "ARCHIVED"],
};

export const evidenceControlledTransitions: ReadonlySet<string> = new Set([
  "PROPOSAL:CONTRACT_PENDING",
  "CONTRACT_PENDING:RETAINER_PENDING",
  "RETAINER_PENDING:BOOKED",
  "POSTPONED:BOOKED",
  "PLANNING:READY",
  "POST_PRODUCTION:DELIVERED",
]);

export type TransitionRoute =
  | "transitionProject"
  | "closeInquiry"
  | "reopenInquiry"
  | "uncancelProject"
  | "reopenJob";

export const reopenJobTransitions: ReadonlyArray<{ from: ProjectStateName; to: ProjectStateName }> = [
  { from: "DELIVERED", to: "POST_PRODUCTION" },
  { from: "REVIEW_REQUESTED", to: "POST_PRODUCTION" },
  { from: "CLOSED", to: "DELIVERED" },
];

/** Which command a move goes through. See the features copy for why. */
export function transitionRoute(from: string, to: string): TransitionRoute {
  if (to === "LOST") return "closeInquiry";
  if (from === "LOST" && to !== "ARCHIVED") return "reopenInquiry";
  if (from === "CANCELLED" && to !== "ARCHIVED") return "uncancelProject";
  if (reopenJobTransitions.some((move) => move.from === from && move.to === to)) return "reopenJob";
  return "transitionProject";
}

/** How long a cancel can be undone. Mirrors features/projects/going-back.ts. */
export const UNCANCEL_WINDOW_DAYS = 30;

/**
 * Why a cancelled job can't be brought back, or null when it can.
 *
 * Only to the stage it was cancelled from, which the cancel records as
 * `cancelledFromState`. A job cancelled before that was recorded is refused
 * rather than guessed at: bringing a wedding back to the wrong stage is how a
 * job skips its signature and retainer.
 */
export function uncancelRefusal(
  project: { state?: unknown; cancelledFromState?: unknown; cancelledAt?: unknown; interruptionAt?: unknown },
  now: string,
): "NOT_CANCELLED" | "UNCANCEL_ORIGIN_UNKNOWN" | "UNCANCEL_WINDOW_PASSED" | null {
  if (project.state !== "CANCELLED") return "NOT_CANCELLED";
  const from = String(project.cancelledFromState ?? "");
  if (from === "CANCELLED" || !transitions.CANCELLED.includes(from as ProjectStateName) || from === "ARCHIVED")
    return "UNCANCEL_ORIGIN_UNKNOWN";
  const at = Date.parse(String(project.cancelledAt ?? project.interruptionAt ?? ""));
  if (!Number.isFinite(at)) return "UNCANCEL_ORIGIN_UNKNOWN";
  if (Date.parse(now) - at > UNCANCEL_WINDOW_DAYS * 86_400_000) return "UNCANCEL_WINDOW_PASSED";
  return null;
}
