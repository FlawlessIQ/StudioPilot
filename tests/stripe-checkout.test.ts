import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStripeCheckoutParams,
  resolveSubscriptionPeriod,
  STRIPE_TRIAL_PERIOD_DAYS,
} from "../functions/src/saas/stripe-checkout.ts";

test("Subscription period resolves from the item and trial when the object lacks top-level periods", () => {
  const trialStart = 1_757_000_000;
  const trialEnd = trialStart + STRIPE_TRIAL_PERIOD_DAYS * 86400;

  // Recent API: no top-level current_period_*, only the item carries them.
  const fromItem = resolveSubscriptionPeriod(
    { trial_start: trialStart, trial_end: trialEnd },
    { current_period_start: trialStart, current_period_end: trialEnd },
  );
  assert.equal(fromItem.start, new Date(trialStart * 1000).toISOString());
  assert.equal(fromItem.end, new Date(trialEnd * 1000).toISOString());

  // Neither object nor item carries a period (a trial mid-provision): fall back
  // to trial_start/end so "Trial ends …" is the real trial end, not a stale one.
  const fromTrial = resolveSubscriptionPeriod({
    trial_start: trialStart,
    trial_end: trialEnd,
  });
  assert.equal(fromTrial.end, new Date(trialEnd * 1000).toISOString());

  // Top-level wins when present (older API / a paid period past the trial).
  const paidEnd = trialEnd + 30 * 86400;
  const fromObject = resolveSubscriptionPeriod(
    { current_period_start: trialEnd, current_period_end: paidEnd, trial_end: trialEnd },
    { current_period_end: 999 },
  );
  assert.equal(fromObject.end, new Date(paidEnd * 1000).toISOString());

  // Nothing at all → null, so the caller keeps the stored value.
  assert.deepEqual(resolveSubscriptionPeriod({}), { start: null, end: null });
});

test("Checkout honours the tenant's existing trial end, not a fresh 14 days (P10)", () => {
  const trialEndIso = new Date(Date.now() + 9 * 86400000).toISOString();
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    trialEndIso,
  });

  assert.equal(STRIPE_TRIAL_PERIOD_DAYS, 14);
  assert.equal(params.get("mode"), "subscription");
  // The real trial end is preserved as a unix timestamp; the old
  // trial_period_days (which restarted the clock) is gone.
  assert.equal(
    params.get("subscription_data[trial_end]"),
    String(Math.floor(Date.parse(trialEndIso) / 1000)),
  );
  assert.equal(params.has("subscription_data[trial_period_days]"), false);
  assert.equal(
    params.get("success_url"),
    "https://studio-cue.com/studio/subscription?checkout=success",
  );
  assert.equal(params.get("subscription_data[metadata][tenantId]"), "tenant_a");
  assert.equal(params.get("metadata[tenantId]"), "tenant_a");
  assert.equal(params.has("customer"), false);
});

test("First checkout starts a fresh 14-day trial anchored at checkout, not the onboarding timestamp", () => {
  // Onboarding wrote trialEndAt ~14 days out seconds ago; honouring it here
  // would hand Stripe <14 whole days and its Checkout page would floor to
  // "13 days free". First checkout must use trial_period_days instead so the
  // buyer gets a full 14 days counted from checkout.
  const trialEndIso = new Date(Date.now() + 14 * 86400000).toISOString();
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    trialEndIso,
    firstCheckout: true,
  });
  assert.equal(
    params.get("subscription_data[trial_period_days]"),
    String(STRIPE_TRIAL_PERIOD_DAYS),
  );
  // The onboarding timestamp is NOT used to anchor the first trial.
  assert.equal(params.has("subscription_data[trial_end]"), false);
});

test("Checkout requires a card up front and takes only a card", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    trialEndIso: new Date(Date.now() + 14 * 86400000).toISOString(),
  });
  // Card required during the trial so it converts/fails on its own rather than
  // becoming a free-forever account.
  assert.equal(params.get("payment_method_collection"), "always");
  // Card only — no Cash App Pay / Klarna on a B2B subscription (P11-methods).
  assert.equal(params.get("payment_method_types[0]"), "card");
});

test("An expired or missing trial re-grants nothing (P10)", () => {
  const past = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    trialEndIso: new Date(Date.now() - 86400000).toISOString(),
  });
  assert.equal(past.has("subscription_data[trial_end]"), false);
  assert.equal(past.has("subscription_data[trial_period_days]"), false);

  const missing = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
  });
  assert.equal(missing.has("subscription_data[trial_end]"), false);
  assert.equal(missing.has("subscription_data[trial_period_days]"), false);
});

test("Stripe Checkout reuses an existing Stripe customer", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    customerId: "cus_existing",
    customerEmail: "owner@studio.test",
    priceId: "price_live",
    tenantId: "tenant_a",
  });

  assert.equal(params.get("customer"), "cus_existing");
  // Stripe rejects customer_email together with customer, so it must not appear.
  assert.equal(params.has("customer_email"), false);
  assert.equal(params.get("line_items[0][price]"), "price_live");
  assert.equal(params.get("line_items[0][quantity]"), "1");
});

test("Checkout prefills the owner's email when there is no customer yet (P11)", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    customerEmail: "owner@studio.test",
    priceId: "price_live",
    tenantId: "tenant_a",
  });
  assert.equal(params.get("customer_email"), "owner@studio.test");
  assert.equal(params.has("customer"), false);
});
