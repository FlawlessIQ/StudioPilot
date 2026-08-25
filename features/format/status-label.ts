/**
 * Record statuses, in the words the reader uses.
 *
 * Status enums are precise and they belong in the engine, the audit log and
 * the API. On screen they leak as "awaiting_signature", "review_required" or
 * a bare "sent" — and on the client and crew portals that is somebody else's
 * system vocabulary shown to a person who never asked for it.
 *
 * Anything unmapped falls back to sentence case with underscores removed,
 * which is right for the long tail and never renders worse than the raw
 * value did.
 *
 * Pure lookup, no I/O.
 */

const LABELS: Record<string, string> = {
  // Signing
  awaiting_signature: "Waiting for signature",
  sent_for_signature: "Sent for signature",
  partially_signed: "Partly signed",
  completed: "Complete",
  declined: "Declined",
  voided: "Cancelled",

  // Money
  paid: "Paid",
  partially_paid: "Part paid",
  sent: "Sent",
  // Raised with the accounting provider but not delivered to the client.
  // "Sent" used to cover this case and it is the difference between an
  // email the client has and one nobody asked the provider to send.
  awaiting_delivery: "Not emailed yet",
  queued: "Queued",
  overdue: "Overdue",
  refunded: "Refunded",
  superseded: "Replaced",
  failed: "Failed",

  // Delivery
  review_required: "Waiting on the studio",
  ready: "Ready",
  released: "Delivered",
  expired: "Expired",

  // Crew
  invited: "Invited",
  viewed: "Opened",
  accepted: "Accepted",
  reassigned: "Reassigned",
  cancelled: "Cancelled",
  exhausted: "Nobody accepted",
  active: "In progress",

  // Documents and requirements
  not_started: "Not started",
  in_progress: "In progress",
  under_review: "Being reviewed",
  correction_required: "Needs a correction",
  waived: "Waived",
  complete: "Complete",
};

/** The reader-facing name of a status value. */
export function statusLabel(value: unknown): string {
  const key = typeof value === "string" ? value : "";
  if (!key) return "";
  return (
    LABELS[key] ??
    key.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase())
  );
}
