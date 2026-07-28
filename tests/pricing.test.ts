import assert from "node:assert/strict";
import test from "node:test";
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
      { key: "solo", monthlyCents: 6_900, yearlyCents: 69_000 },
      { key: "studio", monthlyCents: 19_900, yearlyCents: 199_000 },
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
