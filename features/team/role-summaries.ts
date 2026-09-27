import type { Role } from "@/features/auth/roles";

/**
 * The roles a studio owner can give someone, and what each can do, in one
 * line. Read from `rolePermissions` (features/auth/roles.ts); keep them in step
 * when a role's permissions change — tests/team-roles.test.ts checks the
 * claims that matter.
 *
 * The Team page offered four role names and no way to learn what any of them
 * meant (docs/ui-audit-2026-09-27.md).
 */
export const ASSIGNABLE_ROLES = [
  "studio_admin",
  "studio_coordinator",
  "staff_photographer",
  "staff_videographer",
] as const satisfies readonly Role[];

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const ROLE_SUMMARY: Record<AssignableRole, string> = {
  studio_admin:
    "Everything except your plan and billing: every job, clients, money, the team and integrations.",
  studio_coordinator:
    "Runs the jobs they're assigned: clients, inquiries, schedules, crew, vendors and client emails. No money or settings.",
  staff_photographer:
    "Sees the jobs they shoot: the schedule, documents and the day's checklist.",
  staff_videographer:
    "Sees the jobs they film: the schedule, documents and the day's checklist.",
};
