/**
 * Where a piece of feedback sits in the team's inbox (docs/console.md,
 * "Inbox and Issues").
 *
 * Two different questions, kept apart on purpose:
 *
 * - `status` (received / planned / shipped / closed) is what the studio sees
 *   on its own Feedback page and what triggers the planned/shipped emails.
 *   It belongs to the studio relationship.
 * - `triage` (new / waiting / linked / closed) is the team's working state:
 *   has anyone looked, are we waiting on the studio, is it part of an issue.
 *
 * Feedback stored before the Console has no `triage`; it is derived. Pure.
 */
export const TRIAGE_STATES = ["new", "waiting", "linked", "closed"] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

export const TRIAGE_LABELS: Record<TriageState, string> = {
  new: "New",
  waiting: "Waiting on studio",
  linked: "Linked to issue",
  closed: "Closed",
};

export function triageOf(feedback: { triage?: unknown; issueId?: unknown; status?: unknown }): TriageState {
  if (feedback.triage === "closed") return "closed";
  if (typeof feedback.issueId === "string" && feedback.issueId) return "linked";
  if (feedback.triage === "waiting" || feedback.triage === "new") return feedback.triage;
  if (feedback.status === "closed" || feedback.status === "shipped") return "closed";
  return "new";
}

export const ISSUE_STATUSES = ["open", "planned", "in_progress", "shipped", "wont_do", "duplicate"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  wont_do: "Won't do",
  duplicate: "Duplicate",
};

export const ISSUE_TYPES = ["bug", "request", "ux"] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  bug: "Bug",
  request: "Request",
  ux: "Confusing",
};

export const ISSUE_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/** The issue type a piece of feedback suggests when it starts a new issue. */
export function issueTypeForKind(kind: unknown): IssueType {
  return kind === "broken" ? "bug" : kind === "confusing" ? "ux" : "request";
}
