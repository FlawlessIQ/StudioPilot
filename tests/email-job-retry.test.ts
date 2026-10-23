import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_MAX_ATTEMPTS,
  EMAIL_PROVIDER_MAX_ATTEMPTS,
  EMAIL_PROVIDER_RETRY_DELAYS_MS,
  retryDelay,
  retryPlanFor,
  retryableJobFailure,
  transientEmailProviderFailure,
} from "../functions/src/operations/job-retry.ts";

/**
 * Emails ride out a SendGrid outage of hours, not minutes.
 *
 * Audit 2026-10-22: every email job had 5 attempts backing off from 30s, so a
 * SendGrid incident longer than about 7.5 minutes dead-lettered everything
 * queued during it — password resets and verification links included — and
 * each needed a manual rerun. Transient SendGrid failures now get their own,
 * longer schedule; nothing else changed.
 */

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const read = (path: string) => readFileSync(path, "utf8");

/** Fail every attempt with the same error and record the waits until the job stops. */
function run(input: { collectionName: string; code: string; message: string; maxAttempts?: number }) {
  const delays: number[] = [];
  for (let attempts = 1; attempts < 100; attempts += 1) {
    const plan = retryPlanFor({ ...input, attempts, maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS });
    if (!plan.retryable) return { attempts, delays, total: delays.reduce((sum, delay) => sum + delay, 0), schedule: plan.schedule };
    delays.push(plan.delayMs);
  }
  throw new Error("never stopped");
}

// ── What counts as transient ──

test("SendGrid unreachable, rate limiting or failing on its side is transient", () => {
  assert.equal(transientEmailProviderFailure("SENDGRID_NETWORK_ERROR", "SENDGRID_NETWORK_ERROR:TimeoutError"), true);
  assert.equal(transientEmailProviderFailure("SENDGRID_NETWORK_ERROR", "SENDGRID_NETWORK_ERROR:TypeError"), true);
  for (const status of [408, 429, 500, 502, 503, 504])
    assert.equal(transientEmailProviderFailure("SENDGRID_SEND_FAILED", `SENDGRID_SEND_FAILED:${status}`), true, String(status));
});

test("SendGrid refusing, and our own errors, are not", () => {
  for (const status of [400, 401, 403, 404, 413])
    assert.equal(transientEmailProviderFailure("SENDGRID_SEND_FAILED", `SENDGRID_SEND_FAILED:${status}`), false, String(status));
  for (const code of ["EMAIL_RECIPIENT_MISSING", "SENDGRID_NOT_CONFIGURED", "PROPOSAL_ATTACHMENT_TOO_LARGE", "TEMPLATE_RENDER_FAILED", "JOB_FAILED"])
    assert.equal(transientEmailProviderFailure(code, `${code}:detail`), false, code);
});

// ── The outage schedule ──

test("the outage schedule doubles to half an hour, then waits an hour at a time", () => {
  assert.deepEqual(
    EMAIL_PROVIDER_RETRY_DELAYS_MS.map((delay) => delay / MINUTE),
    [0.5, 1, 2, 4, 8, 16, 30, 60, 60, 60],
  );
  assert.equal(EMAIL_PROVIDER_MAX_ATTEMPTS, 11);
  assert.ok(EMAIL_PROVIDER_RETRY_DELAYS_MS.every((delay) => delay <= HOUR), "capped at an hour");
});

test("a SendGrid 503 keeps retrying for at least three hours", () => {
  const outage = run({ collectionName: "emailJobs", code: "SENDGRID_SEND_FAILED", message: "SENDGRID_SEND_FAILED:503" });
  assert.equal(outage.attempts, 11);
  assert.equal(outage.schedule, "email_provider");
  assert.ok(outage.total >= 3 * HOUR, `only ${outage.total / MINUTE} minutes`);
  assert.equal(outage.total, 4 * HOUR + 1.5 * MINUTE);
});

test("so do a 429 and a send that never got an answer", () => {
  for (const [code, message] of [
    ["SENDGRID_SEND_FAILED", "SENDGRID_SEND_FAILED:429"],
    ["SENDGRID_NETWORK_ERROR", "SENDGRID_NETWORK_ERROR:TimeoutError"],
  ] as const) {
    const outage = run({ collectionName: "emailJobs", code, message });
    assert.ok(outage.total >= 3 * HOUR, code);
  }
});

test("the outage schedule applies whatever maxAttempts the job was queued with", () => {
  // Jobs are queued with maxAttempts: 5; that must not cut an outage short.
  const queuedWithFive = run({ collectionName: "emailJobs", code: "SENDGRID_SEND_FAILED", message: "SENDGRID_SEND_FAILED:500", maxAttempts: 5 });
  assert.equal(queuedWithFive.attempts, EMAIL_PROVIDER_MAX_ATTEMPTS);
  // A job that asked for more keeps them, at the hourly cap.
  const queuedWithFifteen = run({ collectionName: "emailJobs", code: "SENDGRID_SEND_FAILED", message: "SENDGRID_SEND_FAILED:500", maxAttempts: 15 });
  assert.equal(queuedWithFifteen.attempts, 15);
  assert.equal(queuedWithFifteen.delays.at(-1), HOUR);
});

test("an outage after other failures still gets the rest of the outage schedule", () => {
  // Attempts 1–4 waited on a meeting link; SendGrid then fails at attempt 5.
  const plan = retryPlanFor({ collectionName: "emailJobs", code: "SENDGRID_SEND_FAILED", message: "SENDGRID_SEND_FAILED:503", attempts: 5, maxAttempts: 5 });
  assert.equal(plan.retryable, true);
  assert.equal(plan.delayMs, 8 * MINUTE);
});

// ── Permanent email failures still fail fast ──

test("a refused recipient or a bad key dead-letters on the first attempt", () => {
  for (const message of ["SENDGRID_SEND_FAILED:400", "SENDGRID_SEND_FAILED:401", "SENDGRID_SEND_FAILED:403"]) {
    const refused = run({ collectionName: "emailJobs", code: "SENDGRID_SEND_FAILED", message });
    assert.equal(refused.attempts, 1, message);
  }
  for (const code of ["EMAIL_RECIPIENT_MISSING", "SENDGRID_NOT_CONFIGURED", "COI_ATTACHMENT_TOO_LARGE", "PROPOSAL_ATTACHMENT_INVALID"]) {
    assert.equal(run({ collectionName: "emailJobs", code, message: code }).attempts, 1, code);
  }
});

test("any other email failure keeps the standard five attempts over about 7.5 minutes", () => {
  const other = run({ collectionName: "emailJobs", code: "CONSULTATION_MEETING_PENDING", message: "CONSULTATION_MEETING_PENDING:the meeting link is still being made" });
  assert.equal(other.attempts, 5);
  assert.equal(other.schedule, "standard");
  assert.deepEqual(other.delays.map((delay) => delay / MINUTE), [0.5, 1, 2, 4]);
});

test("an outage that is used up stops at the job's own budget on an ordinary failure", () => {
  const plan = retryPlanFor({ collectionName: "emailJobs", code: "JOB_FAILED", message: "JOB_FAILED", attempts: 8, maxAttempts: 5 });
  assert.equal(plan.retryable, false);
});

// ── Other job types are unchanged ──

test("provider, AI and PDF jobs keep the standard schedule, even on a 503", () => {
  for (const collectionName of ["providerJobs", "aiJobs", "pdfJobs"]) {
    const failing = run({ collectionName, code: "SENDGRID_SEND_FAILED", message: "SENDGRID_SEND_FAILED:503" });
    assert.equal(failing.attempts, 5, collectionName);
    assert.equal(failing.schedule, "standard", collectionName);
    assert.deepEqual(failing.delays, [1, 2, 3, 4].map(retryDelay), collectionName);
  }
  const provider = run({ collectionName: "providerJobs", code: "QUICKBOOKS_CREATE_FAILED", message: "QUICKBOOKS_CREATE_FAILED:503:PROVIDER_ERROR" });
  assert.equal(provider.attempts, 5);
});

test("the classification of other job types is as it was", () => {
  assert.equal(retryableJobFailure("providerJobs", "DROPBOX_SIGN_CREATE_FAILED", "DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR"), false);
  assert.equal(retryableJobFailure("providerJobs", "ZOOM_CREATE_FAILED", "ZOOM_CREATE_FAILED:429:PROVIDER_ERROR"), true);
  assert.equal(retryableJobFailure("providerJobs", "ZOOM_CREATE_FAILED", "ZOOM_CREATE_FAILED:500:PROVIDER_ERROR"), true);
  assert.equal(retryableJobFailure("aiJobs", "VERTEX_AI_NOT_CONFIGURED", "VERTEX_AI_NOT_CONFIGURED"), false);
  assert.equal(retryableJobFailure("aiJobs", "VERTEX_STUDIO_IMPORT_FAILED", "VERTEX_STUDIO_IMPORT_FAILED:400"), false);
  assert.equal(retryableJobFailure("aiJobs", "VERTEX_STUDIO_IMPORT_FAILED", "VERTEX_STUDIO_IMPORT_FAILED:503"), true);
  assert.equal(retryableJobFailure("pdfJobs", "PDF_RENDER_FAILED", "PDF_RENDER_FAILED"), true);
  assert.deepEqual([1, 2, 3, 4, 20].map(retryDelay), [30_000, 60_000, 120_000, 240_000, 6 * HOUR]);
});

// ── The worker uses it ──

test("the worker takes its retry decision from the plan", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /import \{ DEFAULT_MAX_ATTEMPTS, retryPlanFor \} from "\.\/job-retry\.js";/);
  assert.match(jobs, /const plan = retryPlanFor\(\{/);
  assert.match(jobs, /new Date\(Date\.now\(\) \+ plan\.delayMs\)\.toISOString\(\)/);
  assert.doesNotMatch(jobs, /const retryDelay =|function retryableJobFailure/, "one copy of the rules, in job-retry.ts");
});

test("a send that got no answer is named, and cannot hang the job at running", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /signal: AbortSignal\.timeout\(SENDGRID_SEND_TIMEOUT_MS\)/);
  assert.match(jobs, /throw new Error\(`SENDGRID_NETWORK_ERROR:\$\{name\}`\)/);
});

test("a retry after SendGrid accepted the email does not send it again", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  const send = jobs.slice(jobs.indexOf("const acceptedMessageId = firstString(document.get(SENDGRID_ACCEPTED_FIELD));"));
  assert.ok(send.length > 0);
  // Skips the fetch when an earlier attempt was accepted…
  assert.match(send, /if \(acceptedMessageId\) \{\s*messageId = acceptedMessageId;\s*\} else \{/);
  // …records acceptance before anything after the send can fail…
  const fetchAt = send.indexOf('await fetch("https://api.sendgrid.com/v3/mail/send"');
  const markAt = send.indexOf("[SENDGRID_ACCEPTED_FIELD]: messageId");
  const saveAt = send.indexOf("await saveMessage(");
  assert.ok(fetchAt > 0 && fetchAt < markAt && markAt < saveAt);
  // …and clears it when the job succeeds, so a later re-queue is a new send.
  assert.match(jobs, /\? \{ \[SENDGRID_ACCEPTED_FIELD\]: null \}/);
});

test("a retry due far in the future is still swept when it comes due", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  // No lower bound on nextAttemptAt: an hour-long wait is picked up as soon as it is due.
  assert.match(jobs, /\.where\("status", "==", "retry_scheduled"\)\s*\.where\("nextAttemptAt", "<=", now\)/);
  // And the task dispatcher schedules the task for the retry time itself.
  const dispatch = read("functions/src/operations/task-queue.ts");
  assert.match(dispatch, /\[document\.get\("nextAttemptAt"\), document\.get\("sendAfter"\)\]/);
});
