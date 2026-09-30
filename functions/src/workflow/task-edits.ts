/**
 * What may happen to a task, a readiness checkpoint, once it exists (wave 3).
 *
 * Tasks only went one way: `createTask` and `completeTask`, and the latter had
 * no status guard, so a cancelled task could be flipped to done and a task
 * marked done by a mis-click stayed done. Nothing could change a title, a due
 * date or who it was for. These rules are pure so tests hold them directly;
 * workflow/commands.ts applies them inside its transaction.
 */

/** The studio roles a task may be assigned to. Crew and clients are not. */
export const TASK_ASSIGNABLE_ROLES = ["studio_owner", "studio_admin", "studio_coordinator"] as const;

/**
 * Settled: done or called off. `completed` is an older spelling two server
 * paths used to write (features/tasks/schema.ts taskIsSettled), still present
 * in live data.
 */
export function taskIsSettled(status: unknown): boolean {
  return ["complete", "completed", "cancelled"].includes(String(status ?? ""));
}

export type TaskMove = "complete" | "reopen" | "cancel" | "update";

/**
 * Whether `move` may be applied to a task in `status`, and the refusal if not.
 *
 * - complete: only an open task. A cancelled task was called off; completing
 *   it would record work nobody did. An already-done one is a double click.
 * - reopen: only a settled one — done or cancelled — back to not started.
 * - cancel: only an open one. The record stays; it is the history.
 * - update: open tasks only. A settled task is the record of what was done;
 *   reopen it first to change it.
 */
export function taskMoveRefusal(status: unknown, move: TaskMove): string | null {
  const value = String(status ?? "");
  const settled = taskIsSettled(value);
  if (move === "reopen") return settled ? null : "TASK_NOT_SETTLED";
  if (value === "cancelled") return "TASK_CANCELLED";
  if (settled) return "TASK_ALREADY_COMPLETE";
  return null;
}

/**
 * Who a task may be assigned to: an active studio member of this tenant, or a
 * studio role. The browser offers these; the server decides.
 */
export function assigneeRefusal(input: {
  assignedUserId: string | null | undefined;
  assignedRole: string | null | undefined;
  /** The membership of `assignedUserId` in this tenant, when one was named. */
  membership: { tenantId?: unknown; status?: unknown; role?: unknown } | null;
  tenantId: string;
}): string | null {
  if (input.assignedRole && !(TASK_ASSIGNABLE_ROLES as readonly string[]).includes(input.assignedRole)) {
    return "TASK_ASSIGNEE_INVALID";
  }
  if (!input.assignedUserId) return null;
  const member = input.membership;
  if (
    !member ||
    member.tenantId !== input.tenantId ||
    member.status !== "active" ||
    !(TASK_ASSIGNABLE_ROLES as readonly string[]).includes(String(member.role))
  ) {
    return "TASK_ASSIGNEE_INVALID";
  }
  return null;
}

/**
 * A checkpoint a person resolved, put back to outstanding.
 *
 * Only `complete` and `waived`: those are the two things `resolveCheckpoint`
 * writes, and so the two a mistaken click can leave behind. It goes back to
 * `ready` when everything it waits on is still settled, otherwise to
 * `not_started`, exactly as a fresh run would have it.
 */
export function checkpointReopenRefusal(status: unknown): string | null {
  return ["complete", "waived"].includes(String(status ?? "")) ? null : "CHECKPOINT_NOT_RESOLVED";
}

export function reopenedCheckpointStatus(dependenciesSettled: boolean): "ready" | "not_started" {
  return dependenciesSettled ? "ready" : "not_started";
}
