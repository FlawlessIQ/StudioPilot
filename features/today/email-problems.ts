/**
 * An email that did not reach the person it was for, in the studio's terms.
 *
 * Two different failures, which Today used to see only one of:
 *
 * - **It did not send.** The job reached `failed` / `dead_letter`. Today said
 *   "An email did not send" and linked to Messages — which never reads
 *   emailJobs — and the card could not be cleared, so it sat there for good.
 * - **It sent and bounced.** The provider accepted it (`succeeded`), then the
 *   receiving server bounced, blocked or dropped it. That was recorded as
 *   `deliveryStatus` on a succeeded job, and Today only looked at failed job
 *   statuses — so a couple whose address had a typo simply never heard from
 *   the studio, and nobody was told.
 *
 * And a third, added 2026-10-23: **it was held back.** A message the studio
 * scheduled for a job cancelled, lost or archived before it was due is not
 * sent, and is recorded `succeeded` with `result.held`, like every held send.
 * Without a card it looked delivered.
 *
 * All three name who it was for, what it was, and why, and act in place: Retry
 * (a failed send), Fix the address (where the address lives), or Leave it.
 *
 * Pure.
 */

export type EmailProblem = {
  /**
   * "failed": never sent. "undelivered": sent, and the receiving side refused
   * it. "held": a message the studio scheduled that StudioCue held back,
   * because the job was cancelled, lost or archived before it was due
   * (functions/src/communications/scheduled-client-message.ts).
   */
  kind: "failed" | "undelivered" | "held";
  title: string;
  /** Why, in a sentence a photographer can act on. */
  reason: string;
  recipient: string | null;
  subject: string | null;
  /** Only a send that failed can be sent again; a bounce needs a new address first. */
  canRetry: boolean;
  /** Where the address can be corrected: the job, or the inquiry. */
  fixHref: string | null;
  /** What the link to `fixHref` says. */
  fixLabel: string;
};

type Row = Record<string, unknown>;

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Platform mail — sign-in links, verification — is not the studio's to fix. */
const PLATFORM_TYPES = new Set([
  "password_reset",
  "email_verification",
  "authorization_code",
]);

export const UNDELIVERED_STATUSES: readonly string[] = [
  "bounce",
  "bounced",
  "blocked",
  "dropped",
  // SendGrid's Activity API spelling of "dropped". Recorded as written until
  // 2026-10-07, so thirteen undelivered emails on prod never reached Today.
  "drop",
];

function failedReason(code: string): string {
  if (code === "EMAIL_RECIPIENT_MISSING")
    return "There's no email address on file for them.";
  if (code === "SENDGRID_NOT_CONFIGURED")
    return "Email sending isn't set up for your studio yet.";
  if (code === "SENDGRID_SEND_FAILED")
    return "The email service turned it down. Retrying usually works.";
  if (/ATTACHMENT/.test(code))
    return "Its attachment couldn't be added.";
  return "It couldn't be sent. Retrying usually works.";
}

function undeliveredCopy(status: string): { title: string; reason: string } {
  if (status === "blocked")
    return {
      title: "An email was refused",
      reason: "Their mail server refused it. Check the address, or ask them for another.",
    };
  if (status === "dropped" || status === "drop")
    return {
      title: "An email was not delivered",
      reason:
        "It was never delivered. The address may have a typo, or it has bounced or opted out before. Check it with them.",
    };
  return {
    title: "An email bounced",
    reason: "Their mail server says this address doesn't exist. It may have a typo.",
  };
}

/** Why a scheduled message was held back, from the stop recorded on it. */
function heldReason(stop: string): string {
  if (stop === "cancelled")
    return "The job was canceled or lost before it was due, so it wasn't sent.";
  if (stop === "put_away")
    return "The job was archived before it was due, so it wasn't sent.";
  if (stop === "on_hold")
    return "The job was put on hold before it was due, so it wasn't sent.";
  if (stop === "automations_paused")
    return "Client emails were paused on this job before it was due, so it wasn't sent.";
  return "The job is no longer there, so it wasn't sent.";
}

export function emailProblemOf(job: Row): EmailProblem | null {
  if (text(job.studioDismissedAt)) return null;
  if (PLATFORM_TYPES.has(text(job.type))) return null;
  // A template test goes to the studio's own address, not a client's.
  if (text(job.id).startsWith("template_test_")) return null;
  const projectId = text(job.projectId);
  const leadId = text(job.leadId);
  const fixHref = projectId
    ? `/studio/projects/${projectId}`
    : leadId
      ? `/studio/leads/${leadId}`
      : null;
  const recipient = text(job.recipient) || null;
  const subject =
    text(job.customSubject) || text(job.subject) || null;
  const status = text(job.status);
  // A held send is recorded as `succeeded` with `result.held`, so it looks
  // delivered unless it is named. Only a message the studio scheduled is
  // shown: an automatic send held because the job was put away is the
  // silence the studio asked for, not a problem.
  const result = (job.result ?? {}) as Row;
  if (
    status === "succeeded" &&
    result.held === "client_outreach_stopped" &&
    text(job.scheduledFor)
  ) {
    return {
      kind: "held",
      title: "A scheduled message wasn't sent",
      reason: heldReason(text(result.reason)),
      recipient,
      subject,
      canRetry: false,
      fixHref: projectId ? `/studio/projects/${projectId}` : null,
      fixLabel: "Open the job",
    };
  }
  if (status === "failed" || status === "dead_letter") {
    const error = (job.error ?? {}) as Row;
    return {
      kind: "failed",
      title: "An email did not send",
      reason: failedReason(text(error.code)),
      recipient,
      subject,
      canRetry: true,
      fixHref,
      fixLabel: "Fix the address",
    };
  }
  const delivery = text(job.deliveryStatus).toLowerCase();
  if (UNDELIVERED_STATUSES.includes(delivery)) {
    const copy = undeliveredCopy(delivery);
    return {
      kind: "undelivered",
      title: copy.title,
      reason: copy.reason,
      recipient,
      subject,
      canRetry: false,
      fixHref,
      fixLabel: "Fix the address",
    };
  }
  return null;
}
