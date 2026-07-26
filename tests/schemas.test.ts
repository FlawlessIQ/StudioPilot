import assert from "node:assert/strict";
import test from "node:test";
import { membershipSchema } from "@/features/memberships/schema";
import { tenantSchema } from "@/features/tenants/schema";

const audit = {
  createdAt: "2026-07-26T12:00:00.000Z",
  updatedAt: "2026-07-26T12:00:00.000Z",
  createdBy: "user-owner",
  updatedBy: "user-owner",
};

test("tenant validation accepts a complete tenant record", () => {
  const result = tenantSchema.safeParse({
    ...audit,
    id: "tenant-a",
    tenantId: "tenant-a",
    businessName: "Alder & Muse Photography",
    legalName: "Alder & Muse Photography LLC",
    brandName: "Alder & Muse",
    timezone: "America/New_York",
    currency: "USD",
    dateFormat: "MMM d, yyyy",
    status: "active",
    subscriptionPlan: "studio",
    archivedAt: null,
  });
  assert.equal(result.success, true);
});

test("membership validation does not allow unknown roles", () => {
  const result = membershipSchema.safeParse({
    ...audit,
    id: "tenant-a_user-a",
    tenantId: "tenant-a",
    userId: "user-a",
    role: "untrusted_admin",
    explicitPermissions: [],
    projectIds: [],
    status: "active",
    archivedAt: null,
  });
  assert.equal(result.success, false);
});
