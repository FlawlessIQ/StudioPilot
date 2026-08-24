import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * A provider refusing is not a provider being slow.
 *
 * Provider failures carry their HTTP status in the message —
 * `DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR`. Everything outside
 * aiJobs and emailJobs used to be retryable, so a Dropbox Sign 402 (the
 * account has no paid API plan) was retried five times across an hour.
 * Nobody was told, because the Today inbox only surfaces provider jobs at
 * `failed` or `dead_letter` — never at `retry_scheduled` — while the
 * contract itself read "Sent".
 *
 * This pins the classification against the source, since the function lives
 * in functions/ and the root tsconfig cannot import it.
 */
const source = readFileSync(
  join(process.cwd(), "functions/src/operations/jobs.ts"),
  "utf8",
);

const block = /if \(collectionName === "providerJobs"\) \{([\s\S]*?)\n  \}/.exec(
  source,
);

test("provider job failures are classified by HTTP status", () => {
  assert.ok(block, "the providerJobs branch of retryableJobFailure is gone");
  const body = block[1] as string;
  assert.match(
    body,
    /status >= 400 && status < 500/,
    "4xx must be treated as the provider refusing, not a transient fault",
  );
  assert.match(
    body,
    /status === 408 \|\| status === 429/,
    "408 and 429 are the provider asking to be called again, and stay retryable",
  );
});

test("the Today inbox only surfaces terminal provider jobs", () => {
  // The reason the classification matters: a retrying job is invisible.
  const inbox = readFileSync(
    join(process.cwd(), "features/today/inbox.ts"),
    "utf8",
  );
  assert.match(
    inbox,
    /\["failed", "dead_letter"\]\.includes\(text\(record\.status\)\)/,
    "if this widens to include retry_scheduled, the comment above is stale",
  );
});
