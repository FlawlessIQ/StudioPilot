import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rolePermissions } from "../features/auth/roles";
import { ASSIGNABLE_ROLES, ROLE_SUMMARY } from "../features/team/role-summaries";

test("every role the Team page offers says what it can do", () => {
  for (const role of ASSIGNABLE_ROLES) assert.ok(ROLE_SUMMARY[role]?.length > 20, role);
});

test("the summaries' claims match the permissions", () => {
  // Admin: everything but billing.
  assert.ok(!rolePermissions.studio_admin.includes("tenant.billing.manage"));
  assert.ok(rolePermissions.studio_admin.includes("financials.read"));
  assert.match(ROLE_SUMMARY.studio_admin, /except your plan and billing/);
  // Coordinator: assigned jobs only, no money.
  assert.ok(rolePermissions.studio_coordinator.includes("projects.read.assigned"));
  assert.ok(!rolePermissions.studio_coordinator.includes("projects.read.all"));
  assert.ok(!rolePermissions.studio_coordinator.includes("financials.read"));
  assert.match(ROLE_SUMMARY.studio_coordinator, /assigned[\s\S]*No money/);
  // Staff: their own jobs, no client emails.
  for (const role of ["staff_photographer", "staff_videographer"] as const) {
    assert.ok(!rolePermissions[role].includes("communications.send"));
    assert.ok(!rolePermissions[role].includes("clients.manage"));
  }
});

test("team actions are labelled, and suspend and remove ask first", () => {
  const source = readFileSync("components/team/team-management.tsx", "utf8");
  assert.doesNotMatch(source, /<UserMinus|<X size/);
  assert.match(source, /setConfirming\(\{ id: member\.id, action: "suspend" \}\)/);
  assert.match(source, /setConfirming\(\{ id: member\.id, action: "remove" \}\)/);
  // The invitation email is sent; the notice must not say it's held back.
  assert.doesNotMatch(source, /remains gated/);
});

test("the Team page and its command are for studio staff, not clients or crew", () => {
  // A client with portal access showed on Team as "Studio Admin", with a role
  // picker whose change made them a coordinator.
  const page = readFileSync("components/team/team-management.tsx", "utf8");
  assert.match(page, /member\.role === "studio_owner" \|\|\s*\(ASSIGNABLE_ROLES as readonly string\[\]\)\.includes\(member\.role\)/);
  const command = readFileSync("functions/src/saas/memberships.ts", "utf8");
  assert.match(command, /!internalRoles\.has\(String\(member\.get\("role"\)\)\)[\s\S]{0,120}MEMBER_NOT_EDITABLE/);
});
