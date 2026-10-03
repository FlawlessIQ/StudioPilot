import type { CoiStatus } from "@/features/insurance/schema";

/**
 * How far a certificate has got, for the track and badge on
 * /studio/insurance.
 *
 * The track once filled by finding the status among its four step keys, so
 * every status that was not one of them — prepared, needs_details, received,
 * venue_acknowledged, failed — showed an empty track, and a certificate the
 * venue had confirmed looked as if nothing had happened. The badge was green
 * only for `approved`, which is the one state that is *not* done: the venue
 * does not have it yet. Every status is mapped here, so a new one is a type
 * error rather than an empty track.
 */

export type CoiTone = "neutral" | "info" | "warning" | "danger" | "success";
export type CoiStepState = "complete" | "needs-action" | "pending";
export type CoiStep = { key: "requested" | "received" | "approved" | "delivered"; label: string; state: CoiStepState };

type Shape = {
  tone: CoiTone;
  /** How many steps, from the first, are complete. */
  complete: 0 | 1 | 2 | 3 | 4;
  /** A step that needs attention, with what it says instead of its label. */
  attention?: { index: 1; label: string };
};

const SHAPES: Record<CoiStatus, Shape> = {
  // Started by StudioCue, nothing sent: before "Requested", and nobody is late.
  prepared: { tone: "neutral", complete: 0 },
  needs_details: { tone: "neutral", complete: 0 },
  self_serve: { tone: "neutral", complete: 0 },
  // With the agent.
  requested: { tone: "info", complete: 1 },
  awaiting_response: { tone: "info", complete: 1 },
  correction_required: { tone: "warning", complete: 1, attention: { index: 1, label: "Needs correction" } },
  // Back, and being checked.
  received: { tone: "info", complete: 2 },
  // The studio's move: read it, then send it.
  under_review: { tone: "warning", complete: 2 },
  approved: { tone: "warning", complete: 3 },
  // Done: the venue has it.
  sent_to_venue: { tone: "success", complete: 4 },
  venue_acknowledged: { tone: "success", complete: 4 },
  // The PDF that came back did not pass the safety check.
  failed: { tone: "danger", complete: 1, attention: { index: 1, label: "Failed check" } },
  cancelled: { tone: "neutral", complete: 0 },
};

const STEPS: Array<Pick<CoiStep, "key" | "label">> = [
  { key: "requested", label: "Requested" },
  { key: "received", label: "Received" },
  { key: "approved", label: "Approved" },
  { key: "delivered", label: "Delivered" },
];

export function coiProgress(status: unknown): { tone: CoiTone; steps: CoiStep[] } {
  const shape: Shape = SHAPES[String(status) as CoiStatus] ?? { tone: "neutral", complete: 0 };
  return {
    tone: shape.tone,
    steps: STEPS.map((step, index) =>
      shape.attention?.index === index
        ? { ...step, label: shape.attention.label, state: "needs-action" }
        : { ...step, state: index < shape.complete ? "complete" : "pending" },
    ),
  };
}

export const COI_STATUSES_WITH_PROGRESS = Object.keys(SHAPES) as CoiStatus[];
