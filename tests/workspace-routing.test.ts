import assert from "node:assert/strict";
import test from "node:test";
import { destinationAfterSignIn } from "@/features/auth/workspace-routing";

test("platform admins with a studio membership choose a workspace", () => {
  assert.equal(
    destinationAfterSignIn({
      platformAdmin: true,
      memberships: [{ tenantId: "tenant-a", role: "studio_owner" }],
    }),
    "/auth/workspaces",
  );
});

test("platform-only accounts still enter platform administration", () => {
  assert.equal(
    destinationAfterSignIn({
      platformAdmin: true,
      memberships: [],
    }),
    "/platform-admin",
  );
});

test("tenant roles route to their constrained portal", () => {
  assert.equal(
    destinationAfterSignIn({
      platformAdmin: false,
      memberships: [{ tenantId: "tenant-a", role: "client" }],
    }),
    "/client",
  );
  assert.equal(
    destinationAfterSignIn({
      platformAdmin: false,
      memberships: [{ tenantId: "tenant-a", role: "subcontractor" }],
    }),
    "/crew",
  );
});

test("a studio operator who is also a client lands in the studio workspace", () => {
  // Order must not matter: a studio membership always wins over portal roles.
  assert.equal(
    destinationAfterSignIn({
      platformAdmin: false,
      memberships: [
        { tenantId: "tenant-a", role: "client" },
        { tenantId: "tenant-b", role: "studio_owner" },
      ],
    }),
    "/studio",
  );
  assert.equal(
    destinationAfterSignIn({
      platformAdmin: false,
      memberships: [
        { tenantId: "tenant-b", role: "studio_owner" },
        { tenantId: "tenant-a", role: "client" },
      ],
    }),
    "/studio",
  );
});
