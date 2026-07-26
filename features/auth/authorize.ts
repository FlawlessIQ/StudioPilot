import type { Permission, Role } from "./roles";
import { hasPermission } from "./roles";

export type AuthorizationContext = {
  userId: string;
  tenantId: string;
  membershipTenantId: string;
  role: Role;
  explicitPermissions?: readonly Permission[];
  allowedProjectIds?: readonly string[];
};

export class AuthorizationError extends Error {
  readonly code = "FORBIDDEN";

  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function authorize(
  context: AuthorizationContext,
  permission: Permission,
  projectId?: string,
): void {
  if (context.tenantId !== context.membershipTenantId) {
    throw new AuthorizationError("Tenant membership does not match the requested tenant.");
  }

  if (!hasPermission(context.role, permission, context.explicitPermissions)) {
    throw new AuthorizationError();
  }

  if (
    projectId &&
    permission === "projects.read.assigned" &&
    !context.allowedProjectIds?.includes(projectId)
  ) {
    throw new AuthorizationError("This project is not assigned to the current user.");
  }
}
