import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStripeCheckoutParams,
  normalizePromotionCode,
  promotionCouponReference,
  resolvePromotion,
  resolveSubscriptionPeriod,
  STRIPE_TRIAL_PERIOD_DAYS,
} from "../functions/src/saas/stripe-checkout.ts";
import { normalizePromotionCode as normalizeBrowserPromotionCode } from "../features/subscriptions/promotion-code.ts";

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
    "https://studio-cue.com/studio/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}",
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

test("Checkout offers its own promotion-code field when no code was carried in", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    firstCheckout: true,
  });
  assert.equal(params.get("allow_promotion_codes"), "true");
  assert.equal(params.has("discounts[0][promotion_code]"), false);
  // A normal studio still gives a card and gets the trial.
  assert.equal(params.get("payment_method_collection"), "always");
  assert.equal(params.get("subscription_data[trial_period_days]"), "14");
});

test("A partial-discount code is applied up front; card and trial unchanged", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    firstCheckout: true,
    promotion: { promotionCodeId: "promo_half", freeForever: false },
  });
  assert.equal(params.get("discounts[0][promotion_code]"), "promo_half");
  // Stripe rejects allow_promotion_codes together with discounts.
  assert.equal(params.has("allow_promotion_codes"), false);
  assert.equal(params.get("payment_method_collection"), "always");
  assert.equal(params.get("subscription_data[trial_period_days]"), "14");
});

test("A 100%-off-forever code skips the card and the trial", () => {
  const params = buildStripeCheckoutParams({
    appUrl: "https://studio-cue.com",
    priceId: "price_live",
    tenantId: "tenant_a",
    firstCheckout: true,
    trialEndIso: new Date(Date.now() + 9 * 86400000).toISOString(),
    promotion: { promotionCodeId: "promo_beta", freeForever: true },
  });
  assert.equal(params.get("discounts[0][promotion_code]"), "promo_beta");
  assert.equal(params.has("allow_promotion_codes"), false);
  assert.equal(params.get("payment_method_collection"), "if_required");
  assert.equal(params.has("subscription_data[trial_period_days]"), false);
  assert.equal(params.has("subscription_data[trial_end]"), false);
  // Still a card-only subscription tied to the tenant.
  assert.equal(params.get("payment_method_types[0]"), "card");
  assert.equal(params.get("subscription_data[metadata][tenantId]"), "tenant_a");
});

test("Promotion codes from a signup link are normalised or dropped", () => {
  assert.equal(normalizePromotionCode(" beta-2026 "), "BETA-2026");
  assert.equal(normalizePromotionCode("BETA"), "BETA");
  assert.equal(normalizePromotionCode("x"), null);
  assert.equal(normalizePromotionCode("bad code"), null);
  assert.equal(normalizePromotionCode("<script>"), null);
  assert.equal(normalizePromotionCode(undefined), null);
  assert.equal(normalizePromotionCode("A".repeat(65)), null);
});

test("Only a live, valid, unexpired, unexhausted code resolves", () => {
  const now = Date.parse("2026-10-01T00:00:00Z");
  const code = { id: "promo_beta", active: true, expires_at: null, max_redemptions: 5, times_redeemed: 1 };
  const free = { id: "BETA", valid: true, percent_off: 100, duration: "forever" };
  assert.deepEqual(resolvePromotion(code, free, now), { promotionCodeId: "promo_beta", freeForever: true });
  // 100% for three months is a discount, not free forever: card still needed.
  assert.deepEqual(
    resolvePromotion(code, { ...free, duration: "repeating", duration_in_months: 3 }, now),
    { promotionCodeId: "promo_beta", freeForever: false },
  );
  assert.deepEqual(
    resolvePromotion(code, { ...free, percent_off: 50 }, now),
    { promotionCodeId: "promo_beta", freeForever: false },
  );
  // Revoked (inactive) code, invalid coupon, expired, used up → null.
  assert.equal(resolvePromotion({ ...code, active: false }, free, now), null);
  assert.equal(resolvePromotion(code, { ...free, valid: false }, now), null);
  assert.equal(resolvePromotion({ ...code, expires_at: now / 1000 - 60 }, free, now), null);
  assert.equal(resolvePromotion({ ...code, times_redeemed: 5 }, free, now), null);
  assert.equal(resolvePromotion({ ...code, id: "co_wrong" }, free, now), null);
  assert.equal(resolvePromotion(null, free, now), null);
});

test("The coupon is read from either Stripe API shape", () => {
  const coupon = { id: "BETA", valid: true };
  assert.deepEqual(promotionCouponReference({ coupon }), coupon);
  assert.equal(promotionCouponReference({ promotion: { type: "coupon", coupon: "BETA" } }), "BETA");
  assert.deepEqual(promotionCouponReference({ promotion: { type: "coupon", coupon } }), coupon);
  assert.equal(promotionCouponReference({}), null);
});

test("The browser keeps the same code shape the server accepts", () => {
  for (const value of [" beta-2026 ", "BETA", "x", "bad code", "<script>", undefined, "A".repeat(65)]) {
    assert.equal(normalizeBrowserPromotionCode(value), normalizePromotionCode(value));
  }
});
