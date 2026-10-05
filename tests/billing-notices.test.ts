import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  graceEndsAt,
  planPriceText,
  trialNoticeDue,
} from "../functions/src/saas/billing-notices.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import { isPlatformEmailType, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-16T15:00:00.000Z");
const inDays = (days: number) => new Date(NOW + days * DAY).toISOString();
const read = (path: string) => readFileSync(path, "utf8");

test("the trial reminder is due in the last three days, once per trial end", () => {
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(2.5) }, NOW), inDays(2.5));
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(3) }, NOW), inDays(3));
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(4) }, NOW), null, "too early");
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(-1) }, NOW), null, "already ended");
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(2), trialEndingNoticeFor: inDays(2) }, NOW), null, "already sent");
  // Extended in the Console: a new end date, a new reminder.
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(2), trialEndingNoticeFor: inDays(-5) }, NOW), inDays(2));
  assert.equal(trialNoticeDue({ status: "trialing", currentPeriodEnd: inDays(2), comped: true }, NOW), null, "comped studios pay nothing");
  assert.equal(trialNoticeDue({ status: "active", currentPeriodEnd: inDays(2) }, NOW), null);
});

test("the price reads the way a studio sees it on the plan page", () => {
  assert.equal(planPriceText(15000, "monthly"), "$150/month");
  assert.equal(planPriceText(299000, "yearly"), "$2,990/year");
  assert.equal(planPriceText(14950, "monthly"), "$149.50/month");
  assert.equal(planPriceText(null, "monthly"), null);
});

test("the failed-payment email promises the same grace end as the banner", () => {
  assert.equal(graceEndsAt("2026-10-16T00:00:00.000Z", NOW), "2026-10-23T00:00:00.000Z");
  assert.equal(graceEndsAt(undefined, NOW), new Date(NOW + 7 * DAY).toISOString(), "no stamp yet: from now");
});

const brand = { studioName: "StudioCue", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never;

test("each billing email says what happens and links to Plan & billing", () => {
  const trial = renderEmailTemplate({
    key: "billing_trial_ending",
    brand,
    recipientName: "Gabe Rivera",
    values: { studioName: "GR Productions", trialEndText: "October 19, 2026", planName: "Studio", priceText: "$150/month", actionUrl: "https://studio-cue.com/studio/subscription" },
  });
  assert.match(trial.subject, /Your StudioCue trial ends October 19, 2026/);
  assert.match(trial.text, /GR Productions ends on October 19, 2026\. Your Studio plan starts then, and the card you added is charged \$150\/month/);
  assert.match(trial.html, /studio-cue\.com\/studio\/subscription/);

  const failed = renderEmailTemplate({
    key: "billing_payment_failed",
    brand,
    values: { studioName: "GR Productions", amountText: "$150.00", graceEndText: "October 26, 2026", actionUrl: "https://studio-cue.com/studio/subscription" },
  });
  assert.match(failed.text, /declined for \$150\.00 for GR Productions’ StudioCue subscription/);
  assert.match(failed.text, /keeps working until October 26, 2026/);
  assert.match(failed.text, /export your data/);

  const recovered = renderEmailTemplate({
    key: "billing_payment_recovered",
    brand,
    values: { studioName: "GR Productions", amountText: "$150.00", actionUrl: "https://studio-cue.com/studio/subscription" },
  });
  assert.match(recovered.text, /\$150\.00 was paid/);
  assert.match(recovered.html, /studio-cue\.com\/studio"/, "opens the studio, not the billing page");
  for (const rendered of [trial, failed, recovered]) assert.doesNotMatch(rendered.text, /wedding|couple/i);
});

test("billing email is StudioCue's own letterhead and is never held when a studio lapses", () => {
  for (const type of ["billing_trial_ending", "billing_payment_failed", "billing_payment_recovered"]) {
    assert.equal(isPlatformEmailType(type), true, type);
    assert.equal(billingHoldApplies("emailJobs", type), false, type);
  }
});

test("the webhook queues the email before committing, and the scheduler is deployed and invocable", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  const branch = stripe.slice(stripe.indexOf('if (event.type === "invoice.paid" || event.type === "invoice.payment_failed"'));
  assert.ok(branch.indexOf("await queueInvoiceNotice(") < branch.indexOf("const batch = db.batch();"), "queued before the batch");
  assert.match(stripe, /if \(!subscription\.get\("lastPaymentFailedAt"\) \|\| !\(Number\(invoice\.amount_paid \?\? 0\) > 0\)\) return;/);
  assert.match(read("functions/src/index.ts"), /export \{ billingNoticeScheduler \} from "\.\/saas\/billing-notices\.js";/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /^\s+billingnoticescheduler$/m);
});
