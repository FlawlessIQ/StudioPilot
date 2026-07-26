import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const readinessItemSchema = z.object({
  checkpointId: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  ownerType: z.string().min(1),
  dueDate: z.string().date().nullable(),
  reason: z.string().min(1),
});

export const readinessAssessmentSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  workflowRunId: z.string().nullable(),
  score: z.number().int().min(0).max(100),
  ready: z.boolean(),
  totalRequired: z.number().int().nonnegative(),
  satisfiedRequired: z.number().int().nonnegative(),
  blockingItems: z.array(readinessItemSchema),
  atRiskItems: z.array(readinessItemSchema),
  overdueItems: z.array(readinessItemSchema),
  recommendedNextAction: z.string().max(500).nullable(),
  calculatedAt: z.string().datetime(),
  rulesVersion: z.number().int().positive(),
  archivedAt: z.string().datetime().nullable(),
});

export type ReadinessAssessment = z.infer<typeof readinessAssessmentSchema>;
