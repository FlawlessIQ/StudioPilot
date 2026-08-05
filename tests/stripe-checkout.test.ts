import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStripeCheckoutParams,
  STRIPE_TRIAL_PERIOD_DAYS,
} from "../functions/src/saas/stripe-checkout.ts";

test("Stripe Checkout starts every new subscription with a 14-day trial", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
  });

  assert.equal(STRIPE_TRIAL_PERIOD_DAYS, 14);
  assert.equal(params.get("mode"), "subscription");
  assert.equal(params.get("subscription_data[trial_period_days]"), "14");
  assert.equal(
    params.get("success_url"),
    "https://studio-cue.com/studio/subscription?checkout=success",
  );
  assert.equal(
    params.get("subscription_data[metadata][tenantId]"),
    "tenant_a",
  );
  assert.equal(params.get("metadata[tenantId]"), "tenant_a");
  assert.equal(params.has("customer"), false);
});

test("Stripe Checkout reuses an existing Stripe customer", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    customerId: "cus_existing",
    priceId: "price_live",
    tenantId: "tenant_a",
  });

  assert.equal(params.get("customer"), "cus_existing");
  assert.equal(params.get("line_items[0][price]"), "price_live");
  assert.equal(params.get("line_items[0][quantity]"), "1");
});
