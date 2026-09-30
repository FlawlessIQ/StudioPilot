/**
 * Who a task is for, as one picker value (wave 3).
 *
 * Every create form hard-coded `assignedUserId: null` and a role, so no task
 * was ever for a person. A task can be for a team member or for a role; the
 * picker holds either as one string, and the server checks the member is
 * active on the team (functions/src/workflow/task-edits.ts). Pure.
 */

export const TASK_ROLES = [
  { value: "studio_owner", label: "The owner" },
  { value: "studio_admin", label: "Any admin" },
  { value: "studio_coordinator", label: "Any coordinator" },
] as const;

export type AssigneeOption = { value: string; label: string };

/** "user:<uid>", "role:<role>", or "" for nobody in particular. */
export function assigneeValue(task: Record<string, unknown>): string {
  if (typeof task.assignedUserId === "string" && task.assignedUserId) return `user:${task.assignedUserId}`;
  if (typeof task.assignedRole === "string" && task.assignedRole) return `role:${task.assignedRole}`;
  return "";
}

export function assigneeFields(value: string): { assignedUserId: string | null; assignedRole: string | null } {
  if (value.startsWith("user:")) return { assignedUserId: value.slice(5) || null, assignedRole: null };
  if (value.startsWith("role:")) return { assignedUserId: null, assignedRole: value.slice(5) || null };
  return { assignedUserId: null, assignedRole: null };
}

/**
 * The picker's choices: active studio members by name, then roles.
 *
 * Only owners and admins can read the team list; a coordinator gets "Me" and
 * the roles, which is everything they could sensibly assign anyway.
 */
export function assigneeOptions(input: {
  members: ReadonlyArray<Record<string, unknown>> | null;
  me: { userId: string | null; name: string };
}): AssigneeOption[] {
  const people = new Map<string, string>();
  for (const member of input.members ?? []) {
    const userId = typeof member.userId === "string" ? member.userId : "";
    if (!userId || member.status !== "active") continue;
    if (!TASK_ROLES.some((role) => role.value === member.role)) continue;
    const name =
      (typeof member.displayName === "string" && member.displayName.trim()) ||
      (typeof member.email === "string" && member.email) ||
      (userId === input.me.userId ? input.me.name : "Team member");
    people.set(userId, userId === input.me.userId ? `${name} (me)` : name);
  }
  if (input.me.userId && !people.has(input.me.userId)) people.set(input.me.userId, `${input.me.name || "Me"} (me)`);
  return [
    { value: "", label: "Anyone on the team" },
    ...[...people.entries()]
      .sort((left, right) => left[1].localeCompare(right[1]))
      .map(([userId, label]) => ({ value: `user:${userId}`, label })),
    ...TASK_ROLES.map((role) => ({ value: `role:${role.value}`, label: role.label })),
  ];
}

/** How a task's assignee reads on its row. */
export function assigneeLabel(value: string, options: readonly AssigneeOption[]): string | null {
  if (!value) return null;
  return options.find((option) => option.value === value)?.label.replace(/ \(me\)$/, " (you)") ?? null;
}
