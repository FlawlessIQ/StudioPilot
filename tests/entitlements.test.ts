import assert from "node:assert/strict";
import test from "node:test";
import {
  hasEntitlement,
  planEntitlements,
} from "@/features/subscriptions/entitlements";

test("plan capabilities are checked through entitlements", () => {
  assert.equal(hasEntitlement(planEntitlements.solo, "coiEnabled"), false);
  assert.equal(hasEntitlement(planEntitlements.studio, "coiEnabled"), true);
  assert.equal(hasEntitlement(planEntitlements.multi_brand, "apiAccessEnabled"), true);
});

test("plan limits match the initial commercial model", () => {
  assert.equal(planEntitlements.solo.maxInternalUsers, 1);
  assert.equal(planEntitlements.studio.maxInternalUsers, 5);
  assert.equal(planEntitlements.multi_brand.maxBrands, 3);
});
