/**
 * Sending a "please sign" email again, by hand (contracts and booking changes),
 * and making a signed copy again. Pure, so both are tested directly.
 *
 * The scheduled reminders (./reminders.ts) go at 3 and 7 days. A studio whose
 * couple says "I never got it", or who is about to call them, needs one now —
 * and a double tap, or a studio chasing hard, must not bury the couple in the
 * same email. So a resend is refused within an hour of the last one, or of the
 * original send.
 */

export const RESEND_SPACING_MS = 60 * 60 * 1000;

/** When the next resend may go, as an ISO time, or null when it may go now. */
export function resendBlockedUntil(lastSentAt: readonly unknown[], now: number): string | null {
  const times = lastSentAt
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));
  if (!times.length) return null;
  const next = Math.max(...times) + RESEND_SPACING_MS;
  return next > now ? new Date(next).toISOString() : null;
}

/**
 * What "Make the signed copy again" should do with the seal job
 * (`pdfJobs/contract_seal_{contractId}`, queued when the couple signed).
 *
 *   requeue      it gave up (dead_letter / failed): run it again from zero
 *   create       there is no job at all: queue one
 *   in_progress  it is queued, running or waiting to retry: leave it
 *   done         it succeeded: there is a copy already
 */
export type SignedCopyRetry = "requeue" | "create" | "in_progress" | "done";

export function signedCopyRetryPlan(job: { exists: boolean; status: unknown }): SignedCopyRetry {
  if (!job.exists) return "create";
  const status = String(job.status ?? "");
  if (status === "succeeded") return "done";
  if (status === "dead_letter" || status === "failed") return "requeue";
  return "in_progress";
}
