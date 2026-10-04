import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { nextBackoff } from "../functions/src/communications/delivery-reconciler.ts";
import { isReservedTestAddress } from "../functions/src/communications/test-address.ts";

const read = (path: string) => readFileSync(path, "utf8");
const MINUTE = 60 * 1000;

// ── Delivery status checker ──

test("a 429 waits at least fifteen minutes, doubling to two hours", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");
  const wait = (consecutive: number, retryAfter: number | null = null) =>
    (Date.parse(nextBackoff(consecutive, retryAfter, now).until) - now) / MINUTE;
  assert.equal(wait(0), 15);
  assert.equal(wait(1), 30);
  assert.equal(wait(2), 60);
  assert.equal(wait(3), 120);
  assert.equal(wait(9), 120, "capped");
  assert.equal(wait(0, 3600), 60, "SendGrid's own Retry-After wins when longer");
  assert.equal(nextBackoff(2, null, now).consecutive, 3);
});

test("the sweep skips while backing off, and a refusal is a warning, not a failure", () => {
  const reconciler = read("functions/src/communications/delivery-reconciler.ts");
  assert.match(reconciler, /if \(backoffUntil && Date\.parse\(backoffUntil\) > Date\.now\(\)\) return;/);
  assert.match(reconciler, /logger\.warn\("email_delivery_reconciler_rate_limited", backoff\);\s*return;/);
  assert.match(reconciler, /if \(caught instanceof ActivityRateLimited\) detailBudget = 0;/);
});

// ── Reserved test addresses ──

test("documentation and test domains are recognised; real ones are not", () => {
  for (const email of [
    "couple@example.com",
    "a@mail.example.org",
    "crew@example.net",
    "owner@studio.test",
    "x@thing.invalid",
    "y@box.localhost",
    "z@shop.example",
    "CAPS@EXAMPLE.COM",
  ]) {
    assert.equal(isReservedTestAddress(email), true, email);
  }
  for (const email of ["gabe@grproductions.com", "someone@examples.com", "a@notexample.com", "a@test.io", "no-at-sign"]) {
    assert.equal(isReservedTestAddress(email), false, email);
  }
});

test("live sending skips them, for the recipient and for anyone copied", () => {
  const jobs = read("functions/src/operations/jobs.ts");
  const live = jobs.slice(jobs.indexOf('if (process.env.EMAIL_DELIVERY_MODE !== "live") {'));
  assert.match(live, /if \(isReservedTestAddress\(recipient\)\) return \{ held: "reserved_test_address", type \};/);
  assert.match(live, /\.filter\(\(email\) => !isReservedTestAddress\(email\)\)/);
});

// ── PDF service ──

test("the PDF service has the memory a full proposal needs", () => {
  const policy = read("cloud-run/capacity-policy.yaml");
  const pdf = policy.slice(policy.indexOf("studiohub-pdf:"), policy.indexOf("studiohub-file-safety:"));
  assert.match(pdf, /concurrency: 2/);
  assert.match(pdf, /memory: 2Gi/);
  assert.match(read("scripts/apply-capacity-policy.sh"), /--cpu 1 --memory 2Gi --concurrency 2 --timeout 600/);
});
