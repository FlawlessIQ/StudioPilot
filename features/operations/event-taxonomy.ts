import { z } from "zod";

export const productEventNameSchema = z.enum([
  "handling.session_started",
  "handling.session_completed",
  "studio_import.session_created",
  "studio_import.file_accepted",
  "studio_import.file_rejected",
  "studio_import.scan_passed",
  "studio_import.scan_failed",
  "studio_import.classification_completed",
  "studio_import.extraction_completed",
  "studio_import.review_completed",
  "studio_import.activated",
  "studio_import.rolled_back",
  "ai_action.queued",
  "ai_action.completed",
  "ai_action.reviewed",
  "ai_action.approved",
  "ai_action.edited",
  "ai_action.rejected",
  "ai_action.dismissed",
  "ai_action.executed",
  "ai_action.failed",
  "automation.started",
  "automation.completed",
  "automation.failed",
  "automation.cancelled",
  "automation.retried",
  "lifecycle.inquiry_received",
  "lifecycle.consultation_scheduled",
  "lifecycle.consultation_completed",
  "lifecycle.proposal_approved",
  "lifecycle.proposal_accepted",
  "lifecycle.contract_completed",
  "lifecycle.retainer_paid",
  "lifecycle.project_booked",
  "lifecycle.questionnaire_completed",
  "lifecycle.schedule_published",
  "lifecycle.coi_approved",
  "lifecycle.final_invoice_paid",
  "lifecycle.crew_staffed",
  "lifecycle.event_completed",
  "lifecycle.gallery_delivered",
  "lifecycle.album_approved",
  "lifecycle.review_requested",
  "lifecycle.project_closed",
]);

export type ProductEventName = z.infer<typeof productEventNameSchema>;

export const productEventSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().nullable(),
  actorId: z.string().min(1),
  actorType: z.enum([
    "user",
    "client",
    "subcontractor",
    "guest",
    "system",
    "provider",
  ]),
  name: productEventNameSchema,
  occurredAt: z.string().datetime(),
  correlationId: z.string().min(1),
  sourceEntityType: z.string().min(1).max(120),
  sourceEntityId: z.string().min(1).max(240),
  properties: z.record(z.string(), z.unknown()),
  handling: z
    .object({
      activeSeconds: z.number().int().nonnegative(),
      baselineSeconds: z.number().int().nonnegative().nullable(),
      verifiedSecondsSaved: z.number().int().nonnegative().nullable(),
      measurementMethod: z.enum([
        "timer",
        "workflow_timestamps",
        "pilot_observation",
        "owner_estimate",
      ]),
    })
    .nullable(),
});

export type ProductEvent = z.infer<typeof productEventSchema>;

export function verifiedSecondsSaved(input: {
  baselineSeconds: number;
  activeSeconds: number;
}): number {
  if (
    !Number.isFinite(input.baselineSeconds) ||
    !Number.isFinite(input.activeSeconds) ||
    input.baselineSeconds < 0 ||
    input.activeSeconds < 0
  ) {
    throw new Error("Handling-time values must be non-negative finite numbers.");
  }
  return Math.max(0, Math.round(input.baselineSeconds - input.activeSeconds));
}
