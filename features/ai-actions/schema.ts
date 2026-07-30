import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const aiCapabilitySchema = z.enum([
  "studio_asset_classification",
  "studio_asset_extraction",
  "studio_workflow_inference",
  "inquiry_fact_extraction",
  "inquiry_reply_draft",
  "consultation_summary",
  "package_recommendation",
  "proposal_draft",
  "contract_mapping",
  "questionnaire_review",
  "schedule_draft",
  "coi_extraction",
  "crew_recommendation",
  "delivery_message_draft",
  "review_request_draft",
  "project_risk_summary",
]);

export const aiAuthorityBoundarySchema = z.enum([
  "advisory",
  "draft_requires_review",
  "human_approval_required",
  "provider_evidence_required",
  "never_ai_authoritative",
]);

export const aiActionStatusSchema = z.enum([
  "queued",
  "running",
  "review_required",
  "approved",
  "rejected",
  "dismissed",
  "executed",
  "failed",
  "cancelled",
]);

export const aiSourceReferenceSchema = z.object({
  entityType: z.string().min(1).max(120),
  entityId: z.string().min(1).max(240),
  versionId: z.string().max(240).nullable(),
  label: z.string().min(1).max(240),
  locator: z.string().max(500).nullable(),
});

export const aiValidationIssueSchema = z.object({
  code: z.string().min(1).max(120),
  severity: z.enum(["info", "warning", "blocking"]),
  message: z.string().min(1).max(1000),
  field: z.string().max(240).nullable(),
});

export const aiActionSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().nullable(),
  actorId: z.string().min(1),
  title: z.string().min(1).max(240).optional(),
  capability: aiCapabilitySchema,
  authorityBoundary: aiAuthorityBoundarySchema,
  status: aiActionStatusSchema,
  modelProvider: z.string().min(1).max(120),
  modelVersion: z.string().min(1).max(160),
  instructionVersion: z.string().min(1).max(160),
  outputSchemaVersion: z.string().min(1).max(160),
  sourceReferences: z.array(aiSourceReferenceSchema).min(1),
  structuredOutput: z.record(z.string(), z.unknown()).nullable(),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    label: z.enum(["low", "medium", "high"]),
    uncertainFields: z.array(z.string().min(1).max(240)),
  }),
  validation: z.object({
    status: z.enum(["pending", "passed", "failed"]),
    issues: z.array(aiValidationIssueSchema),
  }),
  decision: z
    .object({
      actorId: z.string().min(1),
      action: z.enum(["approved", "rejected", "dismissed"]),
      decidedAt: z.string().datetime(),
      note: z.string().max(2000).nullable(),
      editDelta: z.record(z.string(), z.unknown()).nullable(),
    })
    .nullable(),
  downstreamCommand: z
    .object({
      commandType: z.string().min(1).max(160),
      commandId: z.string().min(1).max(240),
      executedAt: z.string().datetime().nullable(),
    })
    .nullable(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    estimatedCostMicros: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    estimatedMinutesSaved: z.number().min(0).max(1440),
  }),
  failure: z
    .object({
      code: z.string().min(1).max(120),
      message: z.string().min(1).max(1000),
      retryable: z.boolean(),
    })
    .nullable(),
  snoozedUntil: z.string().datetime().nullable().optional(),
  archivedAt: z.string().datetime().nullable(),
});

export type AiAction = z.infer<typeof aiActionSchema>;

export function aiActionMayExecute(action: AiAction): boolean {
  if (action.validation.status !== "passed") return false;
  if (action.validation.issues.some((issue) => issue.severity === "blocking")) {
    return false;
  }
  if (
    action.authorityBoundary === "provider_evidence_required" ||
    action.authorityBoundary === "never_ai_authoritative"
  ) {
    return false;
  }
  if (
    action.authorityBoundary === "draft_requires_review" ||
    action.authorityBoundary === "human_approval_required"
  ) {
    return action.status === "approved" && action.decision?.action === "approved";
  }
  return action.status === "approved" || action.status === "review_required";
}

export const actionReceiptSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().nullable(),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2000),
  status: z.enum([
    "queued",
    "running",
    "completed",
    "failed",
    "cancelled",
    "retry_scheduled",
  ]),
  source: z.string().min(1).max(120),
  affectedEntityType: z.string().min(1).max(120),
  affectedEntityId: z.string().min(1).max(240),
  providerEvidence: z.record(z.string(), z.unknown()).nullable(),
  reversible: z.boolean(),
  retryable: z.boolean(),
  canCancel: z.boolean(),
  canRetry: z.boolean(),
  attempts: z.number().int().nonnegative(),
  completedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type ActionReceipt = z.infer<typeof actionReceiptSchema>;

export function aiActionVisibleInQueue(
  action: Pick<AiAction, "status" | "snoozedUntil">,
  now: string,
): boolean {
  if (!["queued", "running", "review_required"].includes(action.status))
    return false;
  if (!action.snoozedUntil) return true;
  return Date.parse(action.snoozedUntil) <= Date.parse(now);
}
