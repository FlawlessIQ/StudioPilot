import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { partnerEarnedCents, suggestPartnerCode, untilBoost } from "@/features/console/partners";
import { CONSOLE_CAPABILITIES } from "@/features/console/roles";
import { resolvePromotion } from "../functions/src/saas/stripe-checkout";

/**
 * The partner program (Conor and GR Productions, 2026-10-07): vendors sell
 * StudioCue to studios; $100 a paid studio, $200 each once there are ten.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("commission: $100 each, then every one at $200 from the tenth", () => {
  assert.equal(partnerEarnedCents(0), 0);
  assert.equal(partnerEarnedCents(1), 10_000);
  assert.equal(partnerEarnedCents(9), 90_000);
  assert.equal(partnerEarnedCents(10), 200_000, "$2,000 for the first ten");
  assert.equal(partnerEarnedCents(11), 220_000);
  assert.equal(untilBoost(7), 3);
  assert.equal(untilBoost(12), 0);
});

test("a partner code is suggested from their name", () => {
  assert.equal(suggestPartnerCode("Albert Gershengoren"), "GERSHE40");
  assert.equal(suggestPartnerCode("Chuck"), "CHUCK40");
});

test("a partner's code puts the studio on the annual price", () => {
  const code = { id: "promo_1", active: true, metadata: { kind: "partner" } };
  const coupon = { valid: true, percent_off: 40, duration: "repeating" };
  assert.equal(resolvePromotion(code, coupon)?.annualOnly, true);
  assert.equal(resolvePromotion({ id: "promo_2", active: true, metadata: {} }, coupon)?.annualOnly, false);
  const stripe = read("functions/src/saas/stripe.ts");
  assert.match(stripe, /priceFor\(parsed\.plan, promotion\?\.annualOnly \? "yearly" : parsed\.cadence\)/);
});

test("the coupon covers the trial and the first annual payment, not the renewal", () => {
  const handler = read("functions/src/console/handlers/partners.ts");
  assert.match(handler, /PARTNER_PERCENT_OFF = 40/);
  assert.match(handler, /duration: "repeating",\s*duration_in_months: PARTNER_DISCOUNT_MONTHS/);
  assert.match(handler, /PARTNER_DISCOUNT_MONTHS = 12/);
  assert.match(handler, /"metadata\[kind\]": "partner"/);
});

test("a studio is tagged at checkout and counts when its first payment clears", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  assert.match(stripe, /await recordReferral\(subscriptionReference\.firestore, \{ tenantId, code: discount\.code, status, now \}\)/);
  assert.match(stripe, /await creditReferral\(db, \{/);
  const referrals = read("functions/src/saas/partner-referrals.ts");
  assert.match(referrals, /if \(!\(input\.amountPaidCents > 0\)\) return;/);
  assert.match(referrals, /if \(!referral\.exists \|\| referral\.get\("paidAt"\)\) return;/);
});

test("owners and operators manage partners; the data is staff-read, never browser-written", () => {
  assert.deepEqual([...CONSOLE_CAPABILITIES["partners.write"]], ["owner", "operator"]);
  const rules = read("firestore.rules");
  for (const collection of ["saasPartners", "saasReferrals", "saasPartnerPayouts"]) {
    assert.match(rules, new RegExp(`match /${collection}/\\{[a-zA-Z]+\\} \\{\\s*allow read: if isPlatformAdmin\\(\\);\\s*allow write: if false;`));
  }
  assert.match(read("functions/src/console/handlers/index.ts"), /\.\.\.partnerHandlers,/);
  assert.match(read("components/console/nav.ts"), /\{ label: "Partners", href: "\/platform-admin\/partners"/);
});
