/**
 * Where a job stands relative to booking.
 *
 * Every dated inquiry becomes a job on arrival (functions/src/intake/convert.ts),
 * so "a job" no longer means "work the studio has won". A couple is a client
 * once they book — contract signed, retainer paid — and until then their job is
 * an inquiry: it lives under Inquiries, not Jobs, stays off the calendar and
 * the "events on the books" counts, and is never counted as a wedding.
 */

export const preBookingStates: ReadonlySet<string> = new Set([
  "LEAD",
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
]);

/** Booked and after — the work the studio has actually won. */
export const bookedStates: ReadonlySet<string> = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
]);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** A job that is still an inquiry: not yet booked, not put away. */
export function isInquiryStage(project: Record<string, unknown>): boolean {
  return preBookingStates.has(text(project.state)) && !project.archivedAt;
}

/**
 * The stage an inquiry is at, in the studio's words, for the Inquiries list.
 * `replied` separates a couple nobody has answered from one in conversation.
 */
export type InquiryStage = "new" | "talking" | "consult" | "proposal" | "signing";

export function inquiryStage(state: string, replied: boolean): InquiryStage {
  if (state === "CONSULTATION") return "consult";
  if (state === "PROPOSAL") return "proposal";
  if (state === "CONTRACT_PENDING" || state === "RETAINER_PENDING") return "signing";
  return replied ? "talking" : "new";
}

export const inquiryStageLabel: Record<InquiryStage, string> = {
  new: "New",
  talking: "Talking",
  consult: "Consult",
  proposal: "Proposal",
  signing: "Signing",
};

/** The Inquiries list's tabs: every open stage, then what closed. */
export const inquiryViews = [
  ["open", "Open"],
  ["new", "New"],
  ["talking", "Talking"],
  ["consult", "Consult"],
  ["proposal", "Proposal"],
  ["signing", "Signing"],
  ["closed", "Closed"],
] as const;

/**
 * Whether the job has passed the booking gate: stamped by the gate, or in a
 * booked-and-after state. Mirrored in functions/src/workflow/
 * readiness-evidence-loader.ts, which cannot import from features/.
 */
export function bookingIsConfirmed(project: Record<string, unknown>): boolean {
  if (typeof project.bookingCompletedAt === "string" && project.bookingCompletedAt) {
    return true;
  }
  return bookedStates.has(String(project.state ?? ""));
}
