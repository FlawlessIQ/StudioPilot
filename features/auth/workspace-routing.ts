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
  const first = memberships[0];
  if (first?.role === "client") return "/client";
  if (first?.role === "subcontractor") return "/crew";
  return "/studio";
}
