import { z } from "zod";

export const roleSchema = z.enum([
  "platform_super_admin",
  "studio_owner",
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
  "staff_videographer",
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

/**
 * Staff who go to the event and shoot it.
 *
 * Every allowlist that used to name `staff_photographer` alone means "a member
 * of staff who works the job", so they read this instead of listing both and
 * drifting apart the next time a trade is added.
 */
export const STAFF_SHOOTER_ROLES: readonly Role[] = [
  "staff_photographer",
  "staff_videographer",
];

export function isStaffShooter(role: string | null | undefined): boolean {
  return STAFF_SHOOTER_ROLES.includes(role as Role);
}

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
  /**
   * The same access as a staff photographer, because it is the same job with a
   * different camera. The reference studio asked for it by name — "Completely
   * separate crew type then photographer" — and a roster that can only be
   * titled "Staff Photographer" misdescribes half of a video-led team.
   *
   * Separate from a crew *trade* (features/crew/schema.ts): a trade says what
   * somebody shoots, this says what they may see and do in the workspace.
   */
  staff_videographer: [
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
