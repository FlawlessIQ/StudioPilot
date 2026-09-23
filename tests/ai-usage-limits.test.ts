import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A month's allowance is not a day's allowance, and a studio can say stop.
 *
 * `consumeAiQuota` capped AI use per month and nothing else. That stops a
 * studio spending more than it bought; it does nothing about spending all of
 * it before lunch. A loop or a retry storm can burn a whole plan in an hour,
 * and the first anyone knows is the bill — or a studio locked out for the rest
 * of the month through no fault of its own.
 *
 * And until now the only way to stop StudioCue using AI on a tenant was to
 * cancel the subscription, which takes the whole product with it.
 *
 * Every AI path in the product passes through this one function, which is why
 * both belong here rather than in each caller.
 */

const usage = readFileSync("functions/src/saas/usage.ts", "utf8");

test("a studio can switch its own AI off without losing the product", () => {
  assert.match(usage, /aiPausedAt/);
  assert.match(usage, /AI_PAUSED_BY_STUDIO/);
  // Checked before the counters: a paused studio should not spend quota
  // finding out that it is paused.
  assert.ok(
    usage.indexOf("aiPausedAt") < usage.indexOf("AI_MONTHLY_QUOTA_EXCEEDED"),
    "the pause must be checked before quota is consumed",
  );
});

test("there is a daily cap as well as a monthly one", () => {
  assert.match(usage, /AI_DAILY_QUOTA_EXCEEDED/);
  assert.match(usage, /dailyLimit/);
  // A floor, so a small plan is still usable, and headroom over an even
  // share, so a genuinely busy Monday is not refused.
  assert.match(usage, /Math\.max\(50,/);
});

test("a refund gives back both counters", () => {
  // Refunding only the month would leave the day quietly spent by calls that
  // never happened — a provider outage failing fifty times would cost a studio
  // its afternoon.
  const refund = usage.slice(usage.indexOf("export async function refundAiQuota"));
  assert.match(refund, /slice\(0, 7\), reservedAt\.slice\(0, 10\)/);
});

test("both refusals reach a person as a sentence", () => {
  // Same class as "INVALID COMMAND:discount" — a code is not an explanation,
  // and a studio hitting a limit needs to know whether waiting fixes it.
  const copy = readFileSync("lib/ai/friendly-error.ts", "utf8");
  for (const code of ["AI_PAUSED_BY_STUDIO", "AI_DAILY_QUOTA_EXCEEDED"])
    assert.match(copy, new RegExp(`${code}: \\(\\) =>`), `${code} needs copy`);
  assert.match(copy, /resets overnight/, "say that waiting fixes it");
  assert.match(copy, /monthly allowance is unaffected/, "and that nothing is lost");
});
