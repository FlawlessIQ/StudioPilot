import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { partnerSignupLink, partnerTally, referralStage } from "../features/console/partner-payouts.ts";
import { classifyStudio } from "../features/console/sources.ts";

/**
 * Referral partners (Conor, 2026-10-12): a vendor's own code, made by Gabe in
 * the Console. $100 per photographer who counts; past 10, $200 each, the first
 * 10 included. Tracked by the code.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const counts = (n: number) => Array.from({ length: n }, () => ({ partnerId: "p1", paidAt: "2026-01-01", qualifiedAt: "2026-04-01" }));

test("$100 a referral that counts; past 10, $200 each, the first 10 included", () => {
  assert.equal(partnerTally(counts(3), []).earnedCents, 30_000);
  assert.equal(partnerTally(counts(10), []).earnedCents, 100_000, "ten is not past ten");
  assert.equal(partnerTally(counts(10), []).toTopRate, 1);
  const eleven = partnerTally(counts(11), []);
  assert.equal(eleven.rateCents, 20_000);
  assert.equal(eleven.earnedCents, 220_000);
  assert.equal(eleven.toTopRate, 0);
  // What's been paid comes off, including the top-up owed when the tier flips.
  assert.equal(partnerTally(counts(11), [{ partnerId: "p1", amountCents: 100_000 }]).owedCents, 120_000);
});

test("only a photographer still paying after 3 months counts", () => {
  assert.equal(referralStage({ signedUpAt: "2026-01-01" }), "trial");
  assert.equal(referralStage({ paidAt: "2026-01-15" }), "paying");
  assert.equal(referralStage({ paidAt: "2026-01-15", qualifiedAt: "2026-04-15" }), "counts");
  assert.equal(referralStage({ forfeitedAt: "2026-02-01" }), "canceled");
  const tally = partnerTally(
    [{ signedUpAt: "x" }, { paidAt: "x" }, { paidAt: "x", qualifiedAt: "y" }, { forfeitedAt: "z" }],
    [],
  );
  assert.deepEqual([tally.signedUp, tally.inTrial, tally.paying, tally.counted, tally.canceled, tally.earnedCents], [4, 1, 1, 1, 1, 10_000]);
});

test("the partner's link applies the code at signup", () => {
  assert.equal(partnerSignupLink("https://studio-cue.com/", "SARAHMUA"), "https://studio-cue.com/auth/register?code=SARAHMUA");
});

test("Sources files a partner's photographer under Referral, by partner", () => {
  const source = classifyStudio({
    tenantId: "t1",
    attribution: null,
    referral: { tenantId: "t1", referrerTenantId: "", partnerId: "p1", referrerName: "Sarah MUA" },
  });
  assert.equal(source.channel, "referral");
  assert.equal(source.detail, "Sarah MUA · partner");
  assert.equal(source.referrerTenantId, null);
});

test("wired: the code is a referral code, checkout and webhook carry the partner, settlement counts it without a Stripe credit", () => {
  const referrals = read("functions/src/saas/referrals.ts");
  assert.match(referrals, /const partnerId = record\.get\("partnerId"\);/);
  assert.match(referrals, /if \(!partner\.exists \|\| partner\.get\("active"\) === false\) return null;/, "a code turned off stops working");
  assert.match(referrals, /if \(referral\.get\("partnerId"\)\) \{\s*await referral\.ref\.update\(\{ qualifiedAt: nowIso, creditedAt: nowIso, creditKind: "partner"/);
  const stripe = read("functions/src/saas/stripe.ts");
  assert.match(stripe, /if \(referral\.partnerId\) params\.set\("subscription_data\[metadata\]\[referralPartnerId\]", referral\.partnerId\);/);
  assert.match(stripe, /partnerId: referralPartnerId \|\| null,/);
  const handlers = read("functions/src/console/handlers/partners.ts");
  assert.match(handlers, /if \(await codeTaken\(db, code\)\) fail\("CODE_TAKEN"\);/);
  assert.match(handlers, /transaction\.create\(codeReference, \{ code, partnerId: reference\.id, createdAt: now \}\);/);
  assert.match(handlers, /recordPartnerPayout: consoleHandler\(\{\s*capability: "billing\.write",/);
  assert.match(read("firestore.rules"), /match \/saasPartnerPayouts\/\{payoutId\} \{\s*allow read: if isPlatformAdmin\(\);\s*allow write: if false;/);
});
