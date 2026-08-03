import type { Role } from "@/features/auth/roles";

export type SignInMembership = {
  tenantId: string;
  role: Role;
};

const studioRoles = new Set<Role>([
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
]);

export function isStudioMembership(
  membership: SignInMembership,
): boolean {
  return studioRoles.has(membership.role);
}

export function destinationAfterSignIn({
  memberships,
  platformAdmin,
}: {
  memberships: SignInMembership[];
  platformAdmin: boolean;
}): string {
  if (platformAdmin && memberships.some(isStudioMembership))
    return "/auth/workspaces";
  if (platformAdmin) return "/platform-admin";
  if (memberships.length === 0) return "/auth/onboarding";
  // A user may hold several memberships at once — e.g. a studio owner who is
  // also a client on their own test project. Route by role precedence
  // (operator > crew > client) rather than off whichever membership happens to
  // be first in the array, which is non-deterministic and would bounce such a
  // user to the wrong workspace.
  if (memberships.some(isStudioMembership)) return "/studio";
  if (memberships.some((membership) => membership.role === "subcontractor"))
    return "/crew";
  if (memberships.some((membership) => membership.role === "client"))
    return "/client";
  return "/studio";
}
