/**
 * Maps a business state/status string to a semantic StatusBadge tone so status
 * reads at a glance: emerald = won/ready/done, amber = in-progress/needs-action,
 * gold = fresh/new, red = negative, grey = archived/closed.
 */
export type StatusTone =
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

// Emerald — advancing / active / won / done.
const POSITIVE = new Set([
  "CONSULTATION",
  "PLANNING",
  "BOOKED",
  "READY",
  "EVENT_COMPLETE",
  "DELIVERED",
  "CONVERTED",
  "ACTIVE",
  "PAID",
  "APPROVED",
  "CONNECTED",
  "COMPLETE",
  "COMPLETED",
  "PUBLISHED",
  "ACCEPTED",
  "WON",
  "QUALIFIED",
  "IN_PROGRESS",
  "SCHEDULED",
]);

// Amber — awaiting action from you or the client.
const IN_PROGRESS = new Set([
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "REVIEWING",
  "REVIEW_REQUESTED",
  "POST_PRODUCTION",
  "PENDING",
  "SUBMITTED",
  "SENT",
]);

const FRESH = new Set(["LEAD", "NEW", "INQUIRY", "DRAFT", "OPEN"]);

const NEGATIVE = new Set([
  "CANCELLED",
  "LOST",
  "POSTPONED",
  "REFUNDED",
  "VOIDED",
  "FAILED",
  "DEAD_LETTER",
  "ERROR",
  "BLOCKED",
  "OVERDUE",
  "DECLINED",
]);

const MUTED = new Set(["ARCHIVED", "CLOSED", "INACTIVE"]);

export function stateTone(state: string | null | undefined): StatusTone {
  const key = String(state ?? "").trim().toUpperCase().replace(/\s+/g, "_");
  if (POSITIVE.has(key)) return "brand";
  if (IN_PROGRESS.has(key)) return "warning";
  if (FRESH.has(key)) return "info";
  if (NEGATIVE.has(key)) return "danger";
  if (MUTED.has(key)) return "neutral";
  return "neutral";
}
