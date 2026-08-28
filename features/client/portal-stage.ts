import type { ClientMilestone } from "@/server/client/portal-experience";

/**
 * Whether a portal area's moment is behind the couple.
 *
 * Every empty state in the client portal was written for a couple who had just
 * arrived. Maya's wedding was shot on 15 August; on the 28th her portal said
 * "Your studio is still preparing your proposal. You'll be notified when it is
 * ready", "Your agreement will appear after the studio sends it for signature",
 * and "A review request may appear after your gallery is delivered" — three
 * promises about a future that had already gone by, on a job where none of
 * those records exists and none now will.
 *
 * The truthful statement is that the record is not held in StudioCue, which is
 * what the studio's own Booking tab now says about the same job.
 *
 * Read from the milestones the portal already computes rather than from the raw
 * project state, which the browser is never given.
 */
export type PortalArea =
  | "proposal"
  | "contract"
  | "questionnaire"
  | "schedule"
  | "delivery"
  | "reviews";

const GATING_MILESTONE: Record<PortalArea, string> = {
  proposal: "booking",
  contract: "booking",
  questionnaire: "planning",
  schedule: "event",
  delivery: "delivery",
  reviews: "delivery",
};

export function portalStageIsBehind(
  milestones: ClientMilestone[] | null | undefined,
  area: PortalArea,
): boolean {
  const gate = GATING_MILESTONE[area];
  return (milestones ?? []).some(
    (milestone) => milestone.id === gate && milestone.status === "complete",
  );
}

/** The headline and body for an area whose moment has gone. */
export function portalPastNotice(area: PortalArea): {
  title: string;
  detail: string;
} {
  switch (area) {
    case "proposal":
      return {
        title: "No proposal is held here",
        detail:
          "Your project moved past this step without one being sent through StudioCue. Your studio has the details — message them if you would like a copy.",
      };
    case "contract":
      return {
        title: "No agreement is held here",
        detail:
          "Your booking was completed without the agreement being signed through StudioCue. Message your studio if you need a copy of it.",
      };
    case "questionnaire":
      return {
        title: "Nothing left to fill in",
        detail:
          "Planning for your project is finished. Message your studio if something still needs changing.",
      };
    case "schedule":
      return {
        title: "Your event has taken place",
        detail:
          "No run of show was published here for it. Message your studio if you would like the timeline they worked from.",
      };
    case "delivery":
      return {
        title: "No gallery is held here",
        detail:
          "Your photographs were shared another way. Message your studio if you need the link again.",
      };
    case "reviews":
      return {
        title: "No review has been requested",
        detail:
          "Your studio has not asked for feedback on this project. You are welcome to message them any time.",
      };
  }
}
