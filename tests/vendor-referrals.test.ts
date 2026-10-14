import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { partnerTally } from "../features/console/partner-payouts.ts";
import { PARTNER_EXPORT_HEADER, partnerExportRows } from "../features/console/partner-import.ts";

/**
 * Referrals across trades (Conor, 2026-10-13: "Build it all"): a partner's or
 * a studio's code works for a DJ, planner, hair or makeup artist too. They get
 * the vendor offer, the partner earns half a photographer's rate, the studio
 * its usual $100 credit, and every trade has a code of its own to share.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const counted = (plan: string | null) => ({ partnerId: "p1", paidAt: "2026-01-01", qualifiedAt: "2026-04-01", plan });

test("every code is half price on every plan and cadence", async () => {
  const { halfOff, REFERRAL_PERCENT_OFF } = await import("../features/subscriptions/referral-program.ts");
  const { planCards, vendorPlanCards } = await import("../config/saas-plans.ts");
  assert.equal(REFERRAL_PERCENT_OFF, 50);
  const halves = [...planCards, ...vendorPlanCards].map((card) => [card.key, halfOff(card.monthlyCents), halfOff(card.yearlyCents)]);
  assert.deepEqual(halves, [["studio", 7_500, 75_000], ["multi_brand", 14_950, 149_500], ["vendor", 5_000, 50_000]]);
  const { OFFER_MONTHLY_CENTS, OFFER_YEARLY_CENTS } = await import("../features/subscriptions/referral-program.ts");
  const { VENDOR_OFFER_MONTHLY_CENTS, VENDOR_OFFER_YEARLY_CENTS } = await import("../features/subscriptions/vendor-offer.ts");
  assert.deepEqual([OFFER_MONTHLY_CENTS, OFFER_YEARLY_CENTS], [halfOff(planCards[0].monthlyCents), halfOff(planCards[0].yearlyCents)]);
  assert.deepEqual([VENDOR_OFFER_MONTHLY_CENTS, VENDOR_OFFER_YEARLY_CENTS], [halfOff(vendorPlanCards[0].monthlyCents), halfOff(vendorPlanCards[0].yearlyCents)]);
});

test("a partner earns $50 a vendor and $100 a photographer; past 10 (both together) $100 and $200", () => {
  const mixed = partnerTally([counted(null), counted("studio"), counted("vendor")], []);
  assert.deepEqual([mixed.counted, mixed.countedVendors, mixed.earnedCents], [3, 1, 25_000]);
  const eleven = partnerTally([...Array.from({ length: 6 }, () => counted("vendor")), ...Array.from({ length: 5 }, () => counted("studio"))], []);
  assert.equal(eleven.toTopRate, 0, "vendors count toward the ten");
  assert.deepEqual([eleven.rateCents, eleven.vendorRateCents], [20_000, 10_000]);
  assert.equal(eleven.earnedCents, 5 * 20_000 + 6 * 10_000);
  // A vendor still in trial earns nothing yet.
  assert.equal(partnerTally([{ partnerId: "p1", plan: "vendor", signedUpAt: "x" }], []).earnedCents, 0);
});

test("checkout honors a studio's or partner's code on the vendor plan, at the vendor offer price", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  // Since 2026-10-14: every plan, and one 50%-off coupon whoever's code it is.
  assert.match(stripe, /firstCheckout && !vendorOffer\s*\? await referredBy/);
  assert.match(stripe, /"discounts\[0\]\[coupon\]",\s*\/\/[^\n]*\n\s*await referralCoupon\(db\),/);
  const referrals = read("functions/src/saas/referrals.ts");
  assert.match(referrals, /percent_off: REFERRAL_PERCENT_OFF,\s*duration: "repeating",\s*duration_in_months: OFFER_MONTHS,/);
  assert.match(read("functions/src/saas/vendor-offer.ts"), /return referralCoupon\(db\);/);
  // The webhook stores which plan the referred customer took, so the partner's rate follows it.
  assert.match(stripe, /partnerId: referralPartnerId \|\| null,\s*plan,/);
  assert.match(read("functions/src/saas/referrals.ts"), /plan: input\.plan \?\? existing\.get\("plan"\) \?\? null/);
  // Before checkout, the page is told both offers and shows the one its trade can pick.
  assert.match(stripe, /plan: "any", referrerName: referral\.referrerName, offer: OFFER_SUMMARY, vendorOffer: VENDOR_OFFER_SUMMARY/);
  const page = read("components/saas/live-subscription.tsx");
  assert.match(page, /vendorPlanOffered && result\.vendorOffer/);
});

test("every trade has a referral card, not just photographers", () => {
  const page = read("components/saas/live-subscription.tsx");
  assert.match(page, /workspace\.role === "studio_owner" \? <ReferralCard \/> : null/);
  assert.doesNotMatch(page, /family === "photo" \? <ReferralCard/);
  const card = read("components/saas/referral-card.tsx");
  assert.match(card, /Refer a friend, get/);
  assert.match(card, /\[\.\.\.planCards, \.\.\.vendorPlanCards\]\.map/);
  assert.match(card, /dollars\(halfOff\(card\.yearlyCents\)\)/);
  assert.doesNotMatch(card, /videographers today, DJs, hair and makeup next/);
});

test("the partner's file says what a vendor gets, about them", () => {
  const [row] = partnerExportRows("https://studio-cue.com", [{ code: "MIKEYBWFZ8", name: "Mikey B", type: "dj" }]);
  const vendor = String(row?.[PARTNER_EXPORT_HEADER.indexOf("What a vendor gets")]);
  assert.match(vendor, /half price for their first 12 months: \$50\/month, or \$500 for their first year/);
});
