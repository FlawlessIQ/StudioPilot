/**
 * A short undo window on the studio's most frequent send.
 *
 * "Send reply" / "Send follow-up" on Today is one tap with no confirm, on
 * purpose: it is pressed dozens of times a day and a confirm on every one
 * would be noise. The cost was that a mis-tap went to the couple with nothing
 * to stop it. So a send from there is held for a few seconds instead —
 * queued as usual, but with `sendAfter` set — and `cancelQueuedEmail` can call
 * it back until it goes.
 *
 * The hold is the queue's own mechanism, not a second one: `nextAttemptAt`
 * is what the task dispatcher schedules the Cloud Task for and what the worker
 * refuses to claim before (operations/jobs.ts `claim`), so a held email is
 * simply a queued email that is not due yet. `sendAfter` says why, and the
 * worker checks it too, so nothing that resets `nextAttemptAt` can shorten
 * the window.
 *
 * Pure, so tests hold the rules directly.
 */

/** How long a held send waits. The studio is shown a little less. */
export const UNDO_SEND_WINDOW_MS = 10_000;

/** The fields that hold a just-queued email for the undo window. */
export function heldSendFields(now: string, requestedBy: string) {
  const sendAfter = new Date(Date.parse(now) + UNDO_SEND_WINDOW_MS).toISOString();
  return {
    sendAfter,
    nextAttemptAt: sendAfter,
    // Who may call it back besides an owner or admin.
    requestedBy,
    cancelledAt: null,
  };
}

/** Whether the worker must leave this job alone for now (or for good). */
export function emailHeldBack(
  job: { sendAfter?: unknown; cancelledAt?: unknown },
  now: string,
): boolean {
  if (typeof job.cancelledAt === "string" && job.cancelledAt) return true;
  return typeof job.sendAfter === "string" && job.sendAfter > now;
}

/** Statuses in which nothing has gone yet, so calling it back is still honest. */
const CANCELLABLE_STATUSES = ["queued", "retry_scheduled"];

/**
 * Why this person may not call this email back, or null.
 *
 * `already_cancelled` is not a refusal: a second press of Undo (or a retry of
 * the first) answers with what the first one did.
 */
export function cancelQueuedEmailRefusal(input: {
  job: {
    tenantId?: unknown;
    status?: unknown;
    sendAfter?: unknown;
    requestedBy?: unknown;
  } | null;
  tenantId: string;
  actorId: string;
  ownerOrAdmin: boolean;
}): string | null | "already_cancelled" {
  const { job } = input;
  if (!job || job.tenantId !== input.tenantId) return "EMAIL_JOB_NOT_FOUND";
  // Only a send that was held for undo. Every other email goes immediately by
  // design, and a scheduled or automated one has its own controls.
  if (typeof job.sendAfter !== "string" || !job.sendAfter) return "EMAIL_NOT_UNDOABLE";
  if (!input.ownerOrAdmin && job.requestedBy !== input.actorId)
    return "EMAIL_UNDO_NOT_ALLOWED";
  const status = String(job.status ?? "");
  if (status === "cancelled") return "already_cancelled";
  if (CANCELLABLE_STATUSES.includes(status)) return null;
  // Running, sent, held by a guard, or failed: it is no longer waiting on us.
  return "EMAIL_ALREADY_SENT";
}

/**
 * The email job id an AI draft's approval sends under.
 *
 * The first approval keeps the id it always had. After an undo the cancelled
 * job keeps that id — it is the record of what was called back — so the next
 * approval needs a new one, or creating it would collide with the cancelled
 * job and read as a double approval.
 */
export function approvedEmailJobId(actionId: string, undoCount: number): string {
  return undoCount > 0 ? `ai_message_${actionId}_u${undoCount}` : `ai_message_${actionId}`;
}
