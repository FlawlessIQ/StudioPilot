import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEntitlement,
  planEntitlements,
} from "@/features/subscriptions/entitlements";

test("plan capabilities are checked through entitlements", () => {
  // COI is no longer a paid differentiator anywhere. It is a venue
  // compliance requirement, and the plan that could not produce one was the
  // plan a small studio would have bought.
  assert.equal(hasEntitlement(planEntitlements.studio, "coiEnabled"), true);
  assert.equal(hasEntitlement(planEntitlements.multi_brand, "coiEnabled"), true);
  // API access is the one capability the ladder still separates.
  assert.equal(hasEntitlement(planEntitlements.studio, "apiAccessEnabled"), false);
  assert.equal(hasEntitlement(planEntitlements.multi_brand, "apiAccessEnabled"), true);
});

test("plan limits match the initial commercial model", () => {
  assert.equal(planEntitlements.studio.maxInternalUsers, 3);
  assert.equal(planEntitlements.studio.maxBrands, 1);
  assert.equal(planEntitlements.multi_brand.maxInternalUsers, 15);
  assert.equal(planEntitlements.multi_brand.maxBrands, 3);
});

test("no plan is capped at a single seat", () => {
  // The reason Solo was removed. maxInternalUsers is enforced as a hard
  // refusal — INTERNAL_USER_LIMIT_REACHED — so a one-seat plan stopped a
  // studio the first time it brought in a second shooter, which is the
  // moment StudioCue is meant to earn its keep.
  for (const [key, entitlements] of Object.entries(planEntitlements)) {
    assert.ok(
      entitlements.maxInternalUsers >= 3,
      `${key} seats ${entitlements.maxInternalUsers}; the floor is a studio, not a person`,
    );
  }
});
