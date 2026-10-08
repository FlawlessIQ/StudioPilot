import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INVITED_VENDOR_TYPES,
  normalizeReferralCode,
  previousQuarter,
  quarterKey,
  referralCodeStem,
  settlement,
} from "../features/subscriptions/referral-program";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the functions copy of the referral rules matches features/", () => {
  const strip = (source: string) => source.replace(/\/\*\*[\s\S]*?\*\//, "");
  assert.equal(strip(read("functions/src/saas/referral-program.ts")), strip(read("features/subscriptions/referral-program.ts")));
});

test("a studio's code comes from its name, without the filler", () => {
  assert.equal(referralCodeStem("GR Productions"), "GRPRODUCTIONS");
  assert.equal(referralCodeStem("Avery Stone Photography"), "AVERYSTONE");
  assert.equal(referralCodeStem("The Studio"), "THESTUDIO");
  assert.ok(referralCodeStem("A").length >= 4);
  assert.ok(referralCodeStem("Hollow Oak Barn Weddings and Events Co").length <= 14);
  assert.equal(normalizeReferralCode(" gr-productions "), "GRPRODUCTIONS");
  assert.equal(normalizeReferralCode("no"), null);
});

test("credits settle the quarter before, for studios still paying", () => {
  assert.equal(quarterKey("2026-11-14T00:00:00Z"), "2026-Q4");
  assert.deepEqual(previousQuarter("2027-01-01T14:00:00Z"), { key: "2026-Q4", startIso: "2026-10-01T00:00:00.000Z", endIso: "2027-01-01T00:00:00.000Z" });
  assert.equal(previousQuarter("2026-10-01T14:00:00Z").key, "2026-Q3");
  const base = { tenantId: "t", referrerTenantId: "r" };
  const before = "2027-01-01T00:00:00.000Z";
  assert.equal(settlement({ ...base, paidAt: "2026-11-02T00:00:00Z" }, "active", before), "credit");
  // Paid, then canceled before the settlement: no credit.
  assert.equal(settlement({ ...base, paidAt: "2026-11-02T00:00:00Z" }, "cancelled", before), "forfeit");
  // Behind on payment: looked at again next quarter.
  assert.equal(settlement({ ...base, paidAt: "2026-11-02T00:00:00Z" }, "past_due", before), "hold");
  // Still in the trial, or paid inside the quarter now running.
  assert.equal(settlement({ ...base, paidAt: null }, "trialing", before), "hold");
  assert.equal(settlement({ ...base, paidAt: "2027-01-01T00:00:01Z" }, "active", before), "hold");
  assert.equal(settlement({ ...base, paidAt: "2026-11-02T00:00:00Z", creditedAt: "2027-01-01T14:00:00Z" }, "active", before), "done");
});

test("vendor invites never go to venues, insurers or a client's own contacts", () => {
  for (const type of ["venue", "insurance_agent", "corporate_contact", "sports_organizer"]) {
    assert.ok(!(INVITED_VENDOR_TYPES as readonly string[]).includes(type), type);
  }
  const sweep = read("functions/src/saas/vendor-invites.ts");
  assert.match(sweep, /clientAutomationsPausedAt/, "imported, quiet bookings are skipped");
  assert.match(sweep, /emailSuppressions/, "an unsubscribed address is skipped");
  assert.match(sweep, /vendorInvitesEnabled/, "a studio can turn invites off");
  assert.match(sweep, /getUserByEmail/, "an existing StudioCue user is skipped");
  assert.match(sweep, /isReservedTestAddress/);
  const sender = read("functions/src/operations/jobs.ts");
  assert.match(sender, /type === "platform_vendor_invite" && \(await getFirestore\(\)\.doc\(`emailSuppressions\//, "the sender checks the opt-out again");
  assert.match(sender, /"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
});

test("the referral price is applied on a first checkout of the Studio plan only, never with the studio's own code", () => {
  const stripe = read("functions/src/saas/stripe.ts");
  assert.match(stripe, /firstCheckout && parsed\.plan === "studio"\s*\?\s*await referredBy\(/);
  assert.match(stripe, /referral\.referrerTenantId === tenantId\) return null/);
  assert.match(stripe, /subscription_data\[metadata\]\[referrerTenantId\]/);
  assert.doesNotMatch(stripe, /annualOnly/);
  const referrals = read("functions/src/saas/referrals.ts");
  assert.match(referrals, /`referral-credit-\$\{creditId\}`/, "a retried settlement can't credit twice");
  assert.match(referrals, /schedule: "0 14 1 1,4,7,10 \*"/);
  // A once-off coupon is spent on the trial's $0 first invoice.
  assert.match(referrals, /duration: "repeating",\s*duration_in_months: OFFER_MONTHS,/);
  assert.doesNotMatch(referrals, /duration: [^\n]*"once"/);
});

test("Partners is gone: no page, handler, rule or statement link left", () => {
  const rules = read("firestore.rules");
  assert.doesNotMatch(rules, /saasPartners|saasPartnerLinks|saasPartnerPayouts/);
  assert.doesNotMatch(read("components/console/nav.ts"), /\/platform-admin\/partners/);
  assert.doesNotMatch(read("functions/src/console/handlers/index.ts"), /partner/i);
});

test("every new scheduler is on the invoker allowlist", () => {
  const script = read("scripts/configure-production-function-invokers.sh");
  assert.match(script, /^\s*referralcreditscheduler$/m);
  assert.match(script, /^\s*vendorinvitescheduler$/m);
});
