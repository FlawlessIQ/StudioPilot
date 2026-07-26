import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import {
  checkpointCompletionMethodSchema,
  checkpointOwnerTypeSchema,
  checkpointVisibilitySchema,
  dueDateRuleSchema,
  escalationRuleSchema,
  reminderRuleSchema,
} from "@/features/workflows/schema";

export const checkpointStatusSchema = z.enum([
  "not_started",
  "ready",
  "in_progress",
  "waiting_on_client",
  "waiting_on_vendor",
  "waiting_on_subcontractor",
  "under_review",
  "complete",
  "waived",
  "failed",
]);

export type CheckpointStatus = z.infer<typeof checkpointStatusSchema>;

export const checkpointEvidenceSchema = z.object({
  type: z.enum(["document", "form", "provider_event", "manual_note", "system_rule"]),
  referenceId: z.string().min(1),
  label: z.string().min(1).max(160),
  recordedAt: z.string().datetime(),
  recordedBy: z.string().min(1),
});

export const checkpointSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  workflowRunId: z.string().min(1),
  templateKey: z.string().min(1),
  name: z.string().min(2).max(160),
  description: z.string().max(2000),
  category: z.string().min(2).max(80),
  ownerType: checkpointOwnerTypeSchema,
  assignedUserId: z.string().nullable(),
  assignedContactId: z.string().nullable(),
  dueDateRule: dueDateRuleSchema,
  resolvedDueDate: z.string().date().nullable(),
  visibility: checkpointVisibilitySchema,
  blocking: z.boolean(),
  dependencyIds: z.array(z.string()),
  completionMethod: checkpointCompletionMethodSchema,
  requiredEvidence: z.array(z.string()),
  reminderRules: z.array(reminderRuleSchema),
  escalationRules: z.array(escalationRuleSchema),
  waiverAllowed: z.boolean(),
  status: checkpointStatusSchema,
  completionTimestamp: z.string().datetime().nullable(),
  completionActorId: z.string().nullable(),
  evidence: z.array(checkpointEvidenceSchema),
  notes: z.string().max(5000).nullable(),
  waiverReason: z.string().max(2000).nullable(),
  waiverExpiresAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type Checkpoint = z.infer<typeof checkpointSchema>;
