import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isStaffShooter,
  rolePermissions,
  roleSchema,
  STAFF_SHOOTER_ROLES,
} from "@/features/auth/roles";
import { authorize } from "@/features/auth/authorize";

/**
 * A staff videographer is staff.
 *
 * The invite dropdown offered Studio Admin, Studio Coordinator and Staff
 * Photographer, and the reference studio asked for staff videographers by
 * name. This is the *membership* role — what they may see and do in the
 * workspace — and is separate from the crew trade in
 * tests/crew-trades.test.ts, which says what somebody shoots.
 */

test("staff videographer is a role", () => {
  assert.equal(roleSchema.safeParse("staff_videographer").success, true);
});

/** Same job, different camera: an access difference would be arbitrary. */
test("a staff videographer has exactly a staff photographer's access", () => {
  assert.deepEqual(
    [...rolePermissions.staff_videographer].sort(),
    [...rolePermissions.staff_photographer].sort(),
  );
});

test("assigned-project access works the same way", () => {
  const context = {
    userId: "videographer-a",
    tenantId: "tenant-a",
    membershipTenantId: "tenant-a",
    role: "staff_videographer" as const,
    allowedProjectIds: ["project-a"],
  };
  assert.doesNotThrow(() =>
    authorize(context, "projects.read.assigned", "project-a"),
  );
  assert.throws(() => authorize(context, "projects.read.assigned", "project-b"));
});

test("the shooter list names both and nothing else", () => {
  assert.deepEqual([...STAFF_SHOOTER_ROLES].sort(), [
    "staff_photographer",
    "staff_videographer",
  ]);
  assert.equal(isStaffShooter("staff_videographer"), true);
  assert.equal(isStaffShooter("studio_owner"), false);
  assert.equal(isStaffShooter(null), false);
});

/**
 * Everywhere that grants studio access by listing roles.
 *
 * A role the workspace boundary has never heard of signs in to nothing: the
 * area allowlists decide whether a member reaches the studio at all, and the
 * command handlers decide whether they may act. Miss one and the invitation
 * sends but the account is inert.
 */
test("every studio allowlist admits a staff videographer", () => {
  const allowlists = [
    "app/api/workspace/bootstrap/route.ts",
    "features/auth/auth-boundary.tsx",
    "features/auth/workspace-context.tsx",
    "features/auth/workspace-routing.ts",
    "functions/src/ai/copilot.ts",
    "functions/src/post-event/commands.ts",
    "functions/src/saas/memberships.ts",
  ];
  for (const path of allowlists) {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    assert.equal(
      source.split('"staff_photographer"').length,
      source.split('"staff_videographer"').length,
      `${path} names one trade more often than the other`,
    );
  }
});

/**
 * Rules are the real boundary, and they are a separate language that cannot
 * import the enum. Every list that names a staff photographer means "staff who
 * works the job".
 */
test("the security rules admit a staff videographer wherever they admit a photographer", () => {
  for (const path of ["firestore.rules", "storage.rules"]) {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    assert.equal(
      source.split('"staff_photographer"').length,
      source.split('"staff_videographer"').length,
      `${path} has a rule that admits only photographers`,
    );
  }
});

test("the team screen offers the role in both the invite and the change", () => {
  const source = readFileSync(
    `${process.cwd()}/components/team/team-management.tsx`,
    "utf8",
  );
  assert.equal(source.split('value="staff_videographer"').length - 1, 2);
});

/** The invitation says what they are being invited as. */
test("an invitation names the role in words", () => {
  const source = readFileSync(
    `${process.cwd()}/features/auth/accept-invitation.tsx`,
    "utf8",
  );
  assert.match(source, /staff_videographer: "a videographer"/);
});
