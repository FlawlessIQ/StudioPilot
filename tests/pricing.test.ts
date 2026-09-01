import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { planCards } from "../config/saas-plans";
import { planEntitlements } from "../features/subscriptions/entitlements";

test("public StudioCue prices match the approved plan ladder", () => {
  assert.deepEqual(
    planCards.map(({ key, monthlyCents, yearlyCents }) => ({
      key,
      monthlyCents,
      yearlyCents,
    })),
    [
      { key: "studio", monthlyCents: 25_000, yearlyCents: 250_000 },
      { key: "multi_brand", monthlyCents: 39_900, yearlyCents: 399_000 },
    ],
  );
});

test("annual StudioCue prices charge for ten months", () => {
  for (const plan of planCards) {
    assert.equal(plan.yearlyCents, plan.monthlyCents * 10);
  }
});

test("displayed plan limits stay aligned with entitlement snapshots", () => {
  for (const plan of planCards) {
    assert.match(plan.users, new RegExp(String(planEntitlements[plan.key].maxInternalUsers)));
    assert.match(plan.ai, new RegExp(planEntitlements[plan.key].aiActionsMonthly.toLocaleString()));
  }
});

test("every published plan is sellable, and nothing sellable is unpublished", () => {
  // A card with no entitlements is a price for something undefined; an
  // entitlement with no card is a plan nobody can buy. Removing Solo touched
  // both tables and a third copy inside functions/, so this checks they came
  // out of it agreeing rather than trusting that they did.
  const published = planCards.map((plan) => plan.key).sort();
  const entitled = Object.keys(planEntitlements).sort();
  assert.deepEqual(published, entitled);

  const functionsCopy = readFileSync("functions/src/saas/stripe.ts", "utf8");
  for (const key of entitled) {
    assert.match(
      functionsCopy,
      new RegExp(`\\b${key}:\\s*\\{`),
      `functions/ has no entitlements for ${key}`,
    );
  }
  // Solo is gone from every copy, including the one that books the charge.
  assert.doesNotMatch(functionsCopy, /^\s+solo:\s*\{/m);
  assert.equal(Object.hasOwn(planEntitlements, "solo"), false);
});

test("every copy of the entitlement table carries the same numbers", () => {
  /**
   * The keys agreeing is not the same as the values agreeing.
   *
   * This table exists four times: the source of truth in features/, the copy
   * inside the Stripe webhook that provisions a paying subscription, the trial
   * copy in onboarding, and the seed. The check above proved only that the
   * same plan names appear in each. Every number could differ, and the one
   * that governs what a studio is allowed to do is whichever copy happened to
   * write their subscription document — so a studio could be sold one thing
   * and provisioned another, with nothing failing.
   */
  const functionsCopy = readFileSync("functions/src/saas/stripe.ts", "utf8");
  for (const [plan, entitlements] of Object.entries(planEntitlements)) {
    const start = functionsCopy.search(new RegExp(`\\b${plan}:\\s*\\{`));
    assert.ok(start >= 0, `functions/ has no ${plan} block`);
    const block = functionsCopy.slice(start, functionsCopy.indexOf("\n  },", start));
    for (const [key, value] of Object.entries(entitlements)) {
      assert.match(
        block,
        new RegExp(`${key}:\\s*${String(value)}\\b`),
        `functions/ ${plan}.${key} is not ${String(value)}`,
      );
    }
  }

  // The trial provisions the entry plan, so it must be the entry plan.
  const onboarding = readFileSync("functions/src/saas/onboarding.ts", "utf8");
  const trial = onboarding.slice(
    onboarding.indexOf("const trialEntitlements"),
  );
  const trialBlock = trial.slice(0, trial.indexOf("\n};"));
  for (const [key, value] of Object.entries(planEntitlements.studio)) {
    assert.match(
      trialBlock,
      new RegExp(`${key}:\\s*${String(value)}\\b`),
      `the trial does not provision studio.${key}`,
    );
  }
});

test("the entry plan carries a crew, not one person", () => {
  // The point of dropping Solo. A one-seat plan charged a studio for the
  // thing that makes StudioCue worth having, and maxInternalUsers is a hard
  // refusal rather than an upgrade prompt.
  const entry = planCards[0]!;
  assert.equal(entry.key, "studio");
  assert.ok(
    planEntitlements[entry.key].maxInternalUsers >= 3,
    "the entry plan must seat a photographer and their crew",
  );
  // COI is a venue requirement, not a premium feature — an entry plan that
  // cannot produce one is unusable for the studios that need it most.
  assert.equal(planEntitlements[entry.key].coiEnabled, true);
});
