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
