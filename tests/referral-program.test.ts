import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  INVITED_VENDOR_TYPES,
  normalizeReferralCode,
  REFERRAL_CREDIT_CENTS,
  creditDueAt,
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

test("the referrer gets $100, once, after the studio has been paying three months", () => {
  assert.equal(REFERRAL_CREDIT_CENTS, 10_000);
  assert.equal(creditDueAt("2026-11-02T10:00:00.000Z"), "2027-02-02T10:00:00.000Z");
  // Nov 30 + 3 months is the end of February, not March 2.
  assert.equal(creditDueAt("2026-11-30T10:00:00.000Z"), "2027-02-28T10:00:00.000Z");
  const base = { tenantId: "t", referrerTenantId: "r", paidAt: "2026-11-02T10:00:00.000Z" };
  assert.equal(settlement(base, "active", "2027-02-02T10:00:00.000Z"), "credit");
  // A day short of three months: not yet.
  assert.equal(settlement(base, "active", "2027-02-01T10:00:00.000Z"), "hold");
  // Canceled inside the three months, or in the trial: no credit, ever.
  assert.equal(settlement(base, "cancelled", "2027-01-05T00:00:00.000Z"), "forfeit");
  assert.equal(settlement({ ...base, paidAt: null }, "cancelled", "2027-01-05T00:00:00.000Z"), "forfeit");
  // Behind on payment, or leaving at period end: held, looked at again tomorrow.
  assert.equal(settlement(base, "past_due", "2027-03-01T00:00:00.000Z"), "hold");
  assert.equal(settlement(base, "cancel_scheduled", "2027-03-01T00:00:00.000Z"), "hold");
  assert.equal(settlement({ ...base, paidAt: null }, "trialing", "2027-03-01T00:00:00.000Z"), "hold");
  // Once-off: a credited referral is never credited again.
  assert.equal(settlement({ ...base, creditedAt: "2027-02-02T14:00:00Z" }, "active", "2027-06-01T00:00:00Z"), "done");
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
  assert.match(read("components/saas/referral-card.tsx"), /one-off \$\{dollars\(status\.creditCents\)\} off your StudioCue bill for each one, once it has been paying for 3 months/);
  assert.match(referrals, /`referral-credit-\$\{referral\.id\}`/, "a retried settlement can't credit twice");
  assert.match(referrals, /schedule: "every day 14:00"/);
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
