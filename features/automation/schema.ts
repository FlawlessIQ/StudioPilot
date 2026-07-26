import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import {
  workflowActionTypeSchema,
  workflowTriggerTypeSchema,
} from "@/features/workflows/schema";

export const automationRunSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().nullable(),
  workflowRunId: z.string().nullable(),
  workflowVersion: z.number().int().positive(),
  automationRuleKey: z.string().min(1),
  trigger: workflowTriggerTypeSchema,
  idempotencyKey: z.string().min(8).max(240),
  inputSnapshot: z.record(z.string(), z.unknown()),
  actionTypes: z.array(workflowActionTypeSchema),
  attemptCount: z.number().int().positive(),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "retry_scheduled",
    "dead_letter",
  ]),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).nullable(),
  retryState: z.object({
    nextAttemptAt: z.string().datetime().nullable(),
    maxAttempts: z.number().int().positive(),
  }),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  manualRerunOfId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type AutomationRun = z.infer<typeof automationRunSchema>;
