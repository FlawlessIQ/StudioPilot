/**
 * When a failed job runs again, and when it stops trying.
 *
 * Pure, with no imports, so tests/email-job-retry.test.ts can load it from the
 * root suite. The worker (operations/jobs.ts `finish`) asks `retryPlanFor`
 * after every failed attempt and writes what it answers.
 *
 * Two schedules:
 *
 * - **Standard**, for every job type: the job's own `maxAttempts` (5 unless the
 *   job says otherwise), backing off 30s, 1m, 2m, 4m — dead-lettered about
 *   7.5 minutes after the first failure.
 * - **Email provider outage**, for emailJobs only, and only when SendGrid
 *   itself was unreachable or overloaded (`transientEmailProviderFailure`).
 *   Found in the reliability audit of 2026-10-22: a SendGrid incident of more
 *   than a few minutes dead-lettered every email queued during it, password
 *   resets and verification links included, and each one needed a manual
 *   rerun. These now ride out about four hours before anyone has to step in.
 *
 * Everything else an email can fail on — a refused recipient, a bad
 * attachment, a render error — keeps the standard schedule and the job's own
 * attempt budget. Waiting longer does not fix those, it only delays the
 * moment Today shows them.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** What a job allows when it doesn't say. Matches the `maxAttempts: 5` jobs are queued with. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** The standard backoff after `attempt` (1-based) failed: 30s doubling, capped at 6 hours. */
export const retryDelay = (attempt: number) =>
  Math.min(6 * 60 * MINUTE, 30 * SECOND * 2 ** Math.max(0, attempt - 1));

/**
 * The wait after each failed attempt while SendGrid is down: entry `n - 1` is
 * the wait after attempt `n`. Doubling from 30 seconds to half an hour, then
 * hourly — 4 hours 1.5 minutes from the first failure to the last attempt.
 */
export const EMAIL_PROVIDER_RETRY_DELAYS_MS: readonly number[] = [
  30 * SECOND,
  1 * MINUTE,
  2 * MINUTE,
  4 * MINUTE,
  8 * MINUTE,
  16 * MINUTE,
  30 * MINUTE,
  60 * MINUTE,
  60 * MINUTE,
  60 * MINUTE,
];

/** One first attempt, then one more after each wait above. */
export const EMAIL_PROVIDER_MAX_ATTEMPTS = EMAIL_PROVIDER_RETRY_DELAYS_MS.length + 1;

/** The HTTP status a failure carries in its message: `SENDGRID_SEND_FAILED:503`. */
function statusOf(message: string): number {
  return Number(message.split(":")[1] ?? 0);
}

/**
 * SendGrid could not take the email right now, as opposed to refusing it.
 *
 * - `SENDGRID_NETWORK_ERROR` — the request never got an answer: DNS, a reset
 *   connection, or no response inside the send timeout.
 * - `SENDGRID_SEND_FAILED` with 408, 429 or any 5xx — SendGrid asking to be
 *   called again later, or failing on its side.
 *
 * Any other 4xx (400 malformed, 401/403 key, 413 too large) is SendGrid saying
 * no, and retrying for hours would only hide it.
 */
export function transientEmailProviderFailure(code: string, message: string): boolean {
  if (code === "SENDGRID_NETWORK_ERROR") return true;
  if (code === "SENDGRID_SEND_FAILED") {
    const status = statusOf(message);
    return status === 408 || status === 429 || status >= 500;
  }
  return false;
}

export function retryableJobFailure(
  collectionName: string,
  code: string,
  message: string,
): boolean {
  if (collectionName === "aiJobs") {
    const permanentAiFailures = new Set([
      "STUDIO_IMPORT_DOCX_TEXT_EXTRACTION_FAILED",
      "STUDIO_IMPORT_NO_ASSETS_EXTRACTED",
      "VERTEX_AI_NOT_CONFIGURED",
    ]);
    if (permanentAiFailures.has(code)) return false;
    if (code === "VERTEX_STUDIO_IMPORT_FAILED") {
      const status = statusOf(message);
      return status === 408 || status === 429 || status >= 500;
    }
  }
  if (collectionName === "providerJobs") {
    // Provider failures carry their HTTP status: `CODE:402:PROVIDER_ERROR`.
    // A 4xx is the provider refusing, not the network faltering, so retrying
    // only delays the moment anyone finds out — and Today surfaces these
    // jobs at `dead_letter`, never at `retry_scheduled`. A Dropbox Sign 402
    // (the account has no paid API plan) was retried five times over an
    // hour while the contract read "Sent" and nothing had been sent.
    //
    // 408 and 429 are the exceptions: both are the provider asking to be
    // called again later.
    const status = Number(message.split(":")[1] ?? 0);
    if (status >= 400 && status < 500) return status === 408 || status === 429;
    return true;
  }
  if (collectionName !== "emailJobs") return true;
  const permanentEmailFailures = new Set([
    "EMAIL_RECIPIENT_MISSING",
    "SENDGRID_NOT_CONFIGURED",
    "COI_ATTACHMENT_REFERENCE_INVALID",
    "COI_ATTACHMENT_TOO_LARGE",
    "PROPOSAL_ATTACHMENT_INVALID",
    "PROPOSAL_ATTACHMENT_REFERENCE_INVALID",
    "PROPOSAL_ATTACHMENT_TOO_LARGE",
  ]);
  if (permanentEmailFailures.has(code)) return false;
  if (code === "SENDGRID_SEND_FAILED") return transientEmailProviderFailure(code, message);
  return true;
}

export type RetryPlan =
  | { retryable: true; delayMs: number; schedule: "standard" | "email_provider" }
  | { retryable: false; delayMs: null; schedule: "standard" | "email_provider" };

/**
 * What to do after attempt number `attempts` (1-based, already counted) failed.
 *
 * The attempt count is shared across causes: a job that already spent its
 * standard budget on, say, a meeting link that wasn't ready still gets the
 * outage schedule's remaining attempts if SendGrid then goes down — and one
 * that spent attempts in an outage stops at its own budget if it then fails
 * for an ordinary reason.
 */
export function retryPlanFor(input: {
  collectionName: string;
  code: string;
  message: string;
  attempts: number;
  maxAttempts: number;
}): RetryPlan {
  const { collectionName, code, message, attempts } = input;
  const maxAttempts = Number.isFinite(input.maxAttempts) ? input.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  if (collectionName === "emailJobs" && transientEmailProviderFailure(code, message)) {
    const budget = Math.max(maxAttempts, EMAIL_PROVIDER_MAX_ATTEMPTS);
    if (attempts >= budget) return { retryable: false, delayMs: null, schedule: "email_provider" };
    const index = Math.min(
      Math.max(0, attempts - 1),
      EMAIL_PROVIDER_RETRY_DELAYS_MS.length - 1,
    );
    return {
      retryable: true,
      delayMs: EMAIL_PROVIDER_RETRY_DELAYS_MS[index] as number,
      schedule: "email_provider",
    };
  }
  if (attempts < maxAttempts && retryableJobFailure(collectionName, code, message))
    return { retryable: true, delayMs: retryDelay(attempts), schedule: "standard" };
  return { retryable: false, delayMs: null, schedule: "standard" };
}
