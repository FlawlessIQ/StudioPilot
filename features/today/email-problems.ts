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
 * Both now name who it was for, what it was, and why, and act in place: Retry
 * (a failed send), Fix the address (where the address lives), or Leave it.
 *
 * Pure.
 */

export type EmailProblem = {
  /** "failed": never sent. "undelivered": sent, and the receiving side refused it. */
  kind: "failed" | "undelivered";
  title: string;
  /** Why, in a sentence a photographer can act on. */
  reason: string;
  recipient: string | null;
  subject: string | null;
  /** Only a send that failed can be sent again; a bounce needs a new address first. */
  canRetry: boolean;
  /** Where the address can be corrected: the job, or the inquiry. */
  fixHref: string | null;
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
  if (status === "dropped")
    return {
      title: "An email was not delivered",
      reason:
        "It was never delivered — this address has bounced or opted out before. Check it with them.",
    };
  return {
    title: "An email bounced",
    reason: "Their mail server says this address doesn't exist. It may have a typo.",
  };
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
    };
  }
  return null;
}
