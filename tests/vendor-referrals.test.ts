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
  assert.match(stripe, /firstCheckout && !vendorOffer && \(parsed\.plan === "studio" \|\| parsed\.plan === "vendor"\)\s*\? await referredBy/);
  assert.match(stripe, /parsed\.plan === "vendor" \? await vendorOfferCoupon\(db, parsed\.cadence\) : await referralCoupon\(db, parsed\.cadence\)/);
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
  assert.match(card, /Pro plan \(DJs, planners, hair and makeup\): \$\{dollars\(VENDOR_OFFER_YEARLY_CENTS\)\} for the year/);
  assert.doesNotMatch(card, /videographers today, DJs, hair and makeup next/);
});

test("the partner's file says what a vendor gets, about them", () => {
  const [row] = partnerExportRows("https://studio-cue.com", [{ code: "MIKEYBWFZ8", name: "Mikey B", type: "dj" }]);
  const vendor = String(row?.[PARTNER_EXPORT_HEADER.indexOf("What a vendor gets")]);
  assert.match(vendor, /\$75\/month for their first 12 months, or \$600 for their first year/);
});
