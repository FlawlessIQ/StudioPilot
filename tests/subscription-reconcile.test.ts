import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeStatus, stripeSubscriptionState, writeSubscriptionFromStripe } from "../functions/src/saas/stripe.ts";
import { reconcileSkipReason, subscriptionDrift } from "../functions/src/saas/subscription-reconcile.ts";

/**
 * subscriptionReconciler (functions/src/saas/subscription-reconcile.ts): a
 * missed Stripe webhook must never leave a paying studio past due. The check
 * and the repair use the webhook's own mapping and write, so they can't drift
 * from what the webhook would have done.
 */

const read = (path: string) => readFileSync(path, "utf8");
const NOW = "2026-10-23T12:00:00.000Z";
const PERIOD_END = 1_793_000_000;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

const snapshot = (data: Record<string, unknown> | null) => ({
  exists: data !== null,
  get: (field: string) => data?.[field],
});

async function webhookWrite(current: Record<string, unknown>, object: Record<string, unknown>) {
  let data: Record<string, unknown> = {};
  const writer = { set: (_reference: unknown, value: Record<string, unknown>) => (data = value) };
  const reference = { firestore: {} } as never;
  await writeSubscriptionFromStripe(writer, reference, snapshot(current) as never, "tenant-a", object, object.status === "canceled", NOW);
  return data;
}

test("the drift check maps Stripe's status the way the webhook does", () => {
  for (const status of ["trialing", "active", "past_due", "unpaid", "paused", "incomplete", "incomplete_expired", "canceled"]) {
    assert.equal(stripeSubscriptionState({ status }, false).status, normalizeStatus(status));
  }
  assert.equal(stripeSubscriptionState({ status: "active" }, true).status, "cancelled", "a deleted subscription is cancelled");
});

test("a studio left past due after paying is drift; one that matches Stripe is not", () => {
  const stripe = { id: "sub_1", status: "active", current_period_end: PERIOD_END, cancel_at_period_end: false };
  assert.deepEqual(subscriptionDrift({ status: "past_due", currentPeriodEnd: PERIOD_END_ISO }, stripe), ["status"]);
  assert.deepEqual(subscriptionDrift({ status: "active", currentPeriodEnd: PERIOD_END_ISO, cancelAtPeriodEnd: false }, stripe), []);
});

test("a renewed period and a scheduled cancellation are drift too", () => {
  const stored = { status: "active", currentPeriodEnd: "2026-09-01T00:00:00.000Z", cancelAtPeriodEnd: false };
  assert.deepEqual(subscriptionDrift(stored, { status: "active", current_period_end: PERIOD_END }), ["currentPeriodEnd"]);
  assert.deepEqual(
    subscriptionDrift({ ...stored, currentPeriodEnd: PERIOD_END_ISO }, { status: "active", current_period_end: PERIOD_END, cancel_at_period_end: true }),
    ["cancelAtPeriodEnd"],
  );
  // The period on the item (recent API versions) counts the same as the top-level one.
  assert.deepEqual(
    subscriptionDrift({ ...stored, currentPeriodEnd: PERIOD_END_ISO }, { status: "active", items: { data: [{ current_period_end: PERIOD_END }] } }),
    [],
  );
  assert.deepEqual(subscriptionDrift(stored, { status: "active" }), [], "a period Stripe didn't report keeps the stored one, as the webhook does");
});

test("a mismatch is repaired with the webhook's update, and the repair leaves no drift", async () => {
  const stored = { status: "past_due", pastDueSince: "2026-10-10T00:00:00.000Z", currentPeriodEnd: "2026-10-01T00:00:00.000Z", cancelAtPeriodEnd: false, plan: "studio" };
  const stripe = { id: "sub_1", customer: "cus_1", status: "active", current_period_end: PERIOD_END, cancel_at_period_end: false };
  const written = await webhookWrite(stored, stripe);
  assert.equal(written.status, "active");
  assert.equal(written.pastDueSince, null, "the grace clock is cleared, so the studio is not read-only");
  assert.equal(written.currentPeriodEnd, PERIOD_END_ISO);
  assert.equal(written.stripeSubscriptionId, "sub_1");
  assert.deepEqual(subscriptionDrift(written, stripe), [], "the check and the write agree");
});

test("local comps and studios with no Stripe subscription are left alone", () => {
  assert.equal(reconcileSkipReason({}), "no_stripe_subscription");
  assert.equal(reconcileSkipReason({ stripeSubscriptionId: "" }), "no_stripe_subscription");
  assert.equal(reconcileSkipReason({ stripeSubscriptionId: "sub_1", comped: true }), "local_comp");
  assert.equal(reconcileSkipReason({ stripeSubscriptionId: "sub_1", comped: true, compMode: "local" }), "local_comp");
  assert.equal(reconcileSkipReason({ stripeSubscriptionId: "sub_1", comped: true, compMode: "stripe_coupon" }), null, "a coupon comp is a Stripe subscription");
  assert.equal(reconcileSkipReason({ stripeSubscriptionId: "sub_1", status: "past_due" }), null);
});

test("the webhook, the Console and the reconciler write through the same core", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  const reconcile = read("functions/src/saas/subscription-reconcile.ts");
  const consoleBilling = read("functions/src/console/handlers/billing.ts");
  const webhook = stripe.slice(stripe.indexOf("export const stripeWebhook"), stripe.indexOf("type SubscriptionWriter"));
  assert.match(webhook, /writeSubscriptionFromStripe\(/, "the webhook writes through writeSubscriptionFromStripe");
  assert.match(reconcile, /writeSubscriptionFromStripe\(/, "the reconciler writes through writeSubscriptionFromStripe");
  assert.match(stripe, /const state = stripeSubscriptionState\(object, deleted\)/, "the webhook's write maps through stripeSubscriptionState");
  assert.match(reconcile, /stripeSubscriptionState\(/, "the drift check maps through stripeSubscriptionState");
  assert.doesNotMatch(reconcile, /normalizeStatus|resolveSubscriptionPeriod/, "no second status or period mapping");
  assert.match(consoleBilling, /syncSubscriptionFromStripe\(/, "the Console's sync is the reconciler's");
  assert.doesNotMatch(consoleBilling, /writeSubscriptionFromStripe/, "the Console has no write of its own");
});

test("the reconciler is deployed, invocable, keyed and alerting", () => {
  const reconcile = read("functions/src/saas/subscription-reconcile.ts");
  assert.match(read("functions/src/index.ts"), /export \{ subscriptionReconciler \} from "\.\/saas\/subscription-reconcile\.js"/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /^\s+subscriptionreconciler$/m);
  assert.match(reconcile, /secrets: \["STRIPE_SECRET_KEY"\]/);
  assert.match(reconcile, /studiocueOperationalError: true,\s+code: "SUBSCRIPTION_RECONCILE_FAILED"/);
  assert.match(reconcile, /startAfter\(/, "pages through every studio");
});
