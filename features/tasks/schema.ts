import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const taskStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "waiting",
  "complete",
  "cancelled",
]);

export const taskPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

export const taskSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  workflowRunId: z.string().nullable(),
  checkpointId: z.string().nullable(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(3000),
  assignedUserId: z.string().nullable(),
  assignedRole: z.string().nullable(),
  dueDate: z.string().date().nullable(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  blocking: z.boolean(),
  completedAt: z.string().datetime().nullable(),
  completedBy: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type Task = z.infer<typeof taskSchema>;

/**
 * Whether a task is finished and needs nobody.
 *
 * The schema's word is `complete`, and `completeTask` writes it. But two server
 * paths that close a task as a side effect — the booking orchestrator when the
 * couple accepts, and `sendAgreement` fulfilling the "Prepare client agreement"
 * task — wrote **`completed`**, which this enum does not contain. Both
 * spellings therefore exist in live data.
 *
 * Two readers had already grown a hand-written `["complete", "completed",
 * "cancelled"]` to cope. The third had not: the "Mark done" button on
 * /studio/tasks checked `complete` alone, so a task the orchestrator had closed
 * kept offering to close it — on a production list, "Prepare client agreement ·
 * completed · Mark done". The same shape as every other allowlist that gets
 * updated in two of the three places that need it.
 *
 * So it is one predicate. The writers now write `complete`; `completed` stays
 * accepted here because rows written before that are still in Firestore and a
 * reader that forgets them puts the button back.
 *
 * Pure.
 */
export function taskIsSettled(status: unknown): boolean {
  return ["complete", "completed", "cancelled"].includes(String(status ?? ""));
}
