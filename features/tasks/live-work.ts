import { taskMomentHasGone, workStillMatters } from "@/features/projects/job-moment";
import { taskIsSettled } from "@/features/tasks/schema";

/**
 * Whether a task's job still wants it: the job is live and the task's moment
 * has not gone with the event. One predicate for every list that surfaces
 * tasks — see features/projects/job-moment.ts for why that matters.
 */
export function taskJobStillWantsIt(record: Record<string, unknown>): boolean {
  const state = String(record.projectState ?? "");
  if (!state) return true;
  if (!workStillMatters(state)) return false;
  return !taskMomentHasGone({
    state,
    dueDate:
      typeof record.dueAt === "string"
        ? record.dueAt
        : typeof record.dueDate === "string"
          ? record.dueDate
          : null,
    eventDate:
      typeof record.projectEventDate === "string" ? record.projectEventDate : null,
  });
}

/**
 * Open work: not done, not cancelled, not archived, and still wanted. The bell
 * listed completed tasks beside open ones and carried no count (UI audit,
 * 2026-10-02); its page and its badge both read this.
 */
export function taskIsOpenWork(record: Record<string, unknown>): boolean {
  if (record.archivedAt) return false;
  if (taskIsSettled(record.status)) return false;
  return taskJobStillWantsIt(record);
}
