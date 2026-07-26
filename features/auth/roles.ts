import { z } from "zod";

export const roleSchema = z.enum([
  "platform_super_admin",
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
  "client",
  "subcontractor",
  "guest",
]);

export type Role = z.infer<typeof roleSchema>;

export const permissionSchema = z.enum([
  "platform.manage",
  "tenant.manage",
  "tenant.billing.manage",
  "members.manage",
  "integrations.manage",
  "projects.read.all",
  "projects.read.assigned",
  "projects.manage",
  "projects.state.override",
  "clients.manage",
  "leads.manage",
  "packages.manage",
  "workflows.manage",
  "schedules.manage",
  "schedules.acknowledge",
  "vendors.manage",
  "crew.manage",
  "documents.manage",
  "communications.send",
  "financials.read",
  "checkpoints.complete",
  "checkpoints.waive",
  "subscription.manage",
  "audit.read",
]);

export type Permission = z.infer<typeof permissionSchema>;

export const rolePermissions: Readonly<Record<Role, readonly Permission[]>> = {
  platform_super_admin: ["platform.manage", "audit.read"],
  studio_owner: [
    "tenant.manage",
    "tenant.billing.manage",
    "members.manage",
    "integrations.manage",
    "projects.read.all",
    "projects.manage",
    "projects.state.override",
    "clients.manage",
    "leads.manage",
    "packages.manage",
    "workflows.manage",
    "schedules.manage",
    "vendors.manage",
    "crew.manage",
    "documents.manage",
    "communications.send",
    "financials.read",
    "checkpoints.complete",
    "checkpoints.waive",
    "subscription.manage",
    "audit.read",
  ],
  studio_admin: [
    "members.manage",
    "integrations.manage",
    "projects.read.all",
    "projects.manage",
    "clients.manage",
    "leads.manage",
    "packages.manage",
    "workflows.manage",
    "schedules.manage",
    "vendors.manage",
    "crew.manage",
    "documents.manage",
    "communications.send",
    "financials.read",
    "checkpoints.complete",
    "audit.read",
  ],
  studio_coordinator: [
    "projects.read.assigned",
    "projects.manage",
    "clients.manage",
    "leads.manage",
    "schedules.manage",
    "vendors.manage",
    "crew.manage",
    "documents.manage",
    "communications.send",
    "checkpoints.complete",
  ],
  staff_photographer: [
    "projects.read.assigned",
    "schedules.acknowledge",
    "documents.manage",
    "checkpoints.complete",
  ],
  client: [],
  subcontractor: ["projects.read.assigned", "schedules.acknowledge", "documents.manage"],
  guest: [],
};

export function hasPermission(
  role: Role,
  permission: Permission,
  explicitPermissions: readonly Permission[] = [],
): boolean {
  return explicitPermissions.includes(permission) || rolePermissions[role].includes(permission);
}
