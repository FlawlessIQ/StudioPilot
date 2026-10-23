"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { assigneeOptions, defaultTaskAssignee, type AssigneeOption } from "@/features/tasks/assignee";

/**
 * The people and roles a task can be for. Owners and admins read the team
 * list; for a coordinator it fails quietly and they get "Me" and the roles.
 */
export function useTaskAssignees(): AssigneeOption[] {
  const workspace = useWorkspace();
  const canReadTeam = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records } = useTenantDocuments("memberships", { enabled: canReadTeam });
  return assigneeOptions({
    members: records,
    me: { userId: workspace.userId, name: workspace.userName },
  });
}

/** Who a new task is for until the studio picks (defaultTaskAssignee). */
export function useDefaultTaskAssignee(): string {
  const workspace = useWorkspace();
  const canReadTeam = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records } = useTenantDocuments("memberships", { enabled: canReadTeam });
  return defaultTaskAssignee({ members: canReadTeam ? records : null, me: { userId: workspace.userId } });
}

export function AssigneeSelect({
  value,
  onChange,
  name,
  label = "For",
}: {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  label?: string;
}) {
  const options = useTaskAssignees();
  return (
    <label>
      {label}
      <select name={name} onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option.value || "anyone"} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
