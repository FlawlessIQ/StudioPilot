import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError, authorize } from "@/features/auth/authorize";
import { hasPermission } from "@/features/auth/roles";

test("studio owners can manage tenant settings", () => {
  assert.equal(hasPermission("studio_owner", "tenant.manage"), true);
});

test("coordinators cannot manage subscriptions", () => {
  assert.equal(hasPermission("studio_coordinator", "subscription.manage"), false);
});

test("tenant isolation rejects a mismatched membership", () => {
  assert.throws(
    () =>
      authorize(
        {
          userId: "user-a",
          tenantId: "tenant-b",
          membershipTenantId: "tenant-a",
          role: "studio_owner",
        },
        "projects.manage",
      ),
    AuthorizationError,
  );
});

test("assigned project access is enforced", () => {
  const context = {
    userId: "photographer-a",
    tenantId: "tenant-a",
    membershipTenantId: "tenant-a",
    role: "staff_photographer" as const,
    allowedProjectIds: ["project-a"],
  };

  assert.doesNotThrow(() => authorize(context, "projects.read.assigned", "project-a"));
  assert.throws(
    () => authorize(context, "projects.read.assigned", "project-b"),
    AuthorizationError,
  );
});
