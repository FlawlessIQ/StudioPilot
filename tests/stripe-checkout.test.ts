import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStripeCheckoutParams,
  STRIPE_TRIAL_PERIOD_DAYS,
} from "../functions/src/saas/stripe-checkout.ts";

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
