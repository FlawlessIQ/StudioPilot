/**
 * Studio feedback: what a studio can tell the StudioCue team, and where each
 * piece of feedback stands.
 *
 * Mirrored in functions/src/feedback/model.ts (functions/ is a separate
 * package with no "@/features" path) and compared below the header by
 * tests/feedback.test.ts.
 */

export const FEEDBACK_KINDS = ["idea", "broken", "confusing", "praise"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  idea: "Idea",
  broken: "Something's broken",
  confusing: "Confusing",
  praise: "Love this",
};

/** What the message box asks, so each kind gets the detail that helps. */
export const FEEDBACK_KIND_PROMPTS: Record<FeedbackKind, string> = {
  idea: "What would make StudioCue better for your studio?",
  broken: "What were you doing, and what happened instead?",
  confusing: "What was unclear? Tell us what you expected.",
  praise: "What's working well for you?",
};

export const FEEDBACK_STATUSES = ["received", "planned", "shipped", "closed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  received: "Received",
  planned: "Planned",
  shipped: "Shipped",
  closed: "Closed",
};

/**
 * The statuses that write back to the person who sent it. Received already
 * has its thank-you, and Closed is a triage state, not news.
 */
export const FEEDBACK_NOTIFYING_STATUSES: readonly FeedbackStatus[] = ["planned", "shipped"];

/** Studio-side roles. Couples, crew and guests don't get the button. */
export const FEEDBACK_ROLES = [
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
  "staff_videographer",
] as const;

export const FEEDBACK_MESSAGE_MAX = 4000;
/** A JPEG of one screen. The browser downsizes before sending. */
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 2_500_000;

export function isFeedbackKind(value: unknown): value is FeedbackKind {
  return FEEDBACK_KINDS.includes(value as FeedbackKind);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return FEEDBACK_STATUSES.includes(value as FeedbackStatus);
}

/** The team inbox's subject line: kind, studio and the start of what they said. */
export function feedbackSubject(kind: FeedbackKind, studioName: string, message: string): string {
  const firstLine = message.trim().split(/\r?\n/)[0] ?? "";
  const excerpt = firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
  return `[Feedback · ${FEEDBACK_KIND_LABELS[kind]}] ${studioName}${excerpt ? ` — ${excerpt}` : ""}`;
}
