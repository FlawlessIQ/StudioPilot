import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const workflowTriggerTypeSchema = z.enum([
  "lead_created",
  "consultation_scheduled",
  "consultation_completed",
  "package_selected",
  "proposal_sent",
  "proposal_accepted",
  "contract_sent",
  "contract_completed",
  "invoice_created",
  "invoice_paid",
  "form_submitted",
  "document_uploaded",
  "coi_received",
  "coi_approved",
  "schedule_approved",
  "crew_assignment_accepted",
  "relative_date_reached",
  "project_status_changed",
  "delivery_completed",
  "review_request_sent",
]);

export const workflowActionTypeSchema = z.enum([
  "create_checkpoint",
  "complete_checkpoint",
  "create_task",
  "assign_task",
  "send_email",
  "send_sms",
  "create_pdf",
  "create_invoice",
  "create_dropbox_folder",
  "upload_file",
  "create_calendar_event",
  "create_zoom_meeting",
  "create_docusign_envelope",
  "invite_portal_user",
  "request_document",
  "update_project_status",
  "send_internal_alert",
  "escalate_item",
  "run_ai_extraction",
  "run_ai_draft",
  "run_ai_schedule_generation",
]);

export const checkpointOwnerTypeSchema = z.enum([
  "studio",
  "client",
  "vendor",
  "subcontractor",
  "system",
]);

export const checkpointVisibilitySchema = z.enum([
  "studio",
  "client",
  "crew",
  "shared",
]);

export const checkpointCompletionMethodSchema = z.enum([
  "manual",
  "form_submitted",
  "file_uploaded",
  "contract_completed",
  "invoice_paid",
  "schedule_approved",
  "assignment_accepted",
  "webhook_event",
  "system_rule",
]);

export const dueDateRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("absolute"),
    date: z.string().date(),
  }),
  z.object({
    type: z.literal("relative"),
    anchor: z.enum([
      "event_date",
      "project_created",
      "booking_date",
      "workflow_started",
    ]),
    offsetDays: z.number().int().min(-3650).max(3650),
  }),
]);

export type DueDateRule = z.infer<typeof dueDateRuleSchema>;

export const reminderRuleSchema = z.object({
  daysBeforeDue: z.number().int().nonnegative().max(365),
  channel: z.enum(["email", "sms", "internal"]),
  recipient: checkpointOwnerTypeSchema,
});

export const escalationRuleSchema = z.object({
  daysOverdue: z.number().int().nonnegative().max(365),
  notifyRole: z.enum(["studio_owner", "studio_admin", "studio_coordinator"]),
});

export const checkpointTemplateSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000),
  category: z.string().trim().min(2).max(80),
  ownerType: checkpointOwnerTypeSchema,
  assignedUserId: z.string().nullable(),
  assignedContactId: z.string().nullable(),
  dueDateRule: dueDateRuleSchema,
  visibility: checkpointVisibilitySchema,
  blocking: z.boolean(),
  dependencies: z.array(z.string().regex(/^[a-z0-9-]+$/)),
  completionMethod: checkpointCompletionMethodSchema,
  requiredEvidence: z.array(z.string().min(1).max(120)),
  reminderRules: z.array(reminderRuleSchema),
  escalationRules: z.array(escalationRuleSchema),
  waiverAllowed: z.boolean(),
});

export type CheckpointTemplate = z.infer<typeof checkpointTemplateSchema>;

export const workflowConditionSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum([
    "equals",
    "not_equals",
    "in",
    "not_in",
    "exists",
    "greater_than",
    "less_than",
  ]),
  value: z.unknown(),
});

export const workflowActionSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  type: workflowActionTypeSchema,
  configuration: z.record(z.string(), z.unknown()),
  requiresApproval: z.boolean(),
});

export const automationRuleSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(160),
  trigger: workflowTriggerTypeSchema,
  conditions: z.array(workflowConditionSchema),
  actions: z.array(workflowActionSchema).min(1),
  active: z.boolean(),
});

export const workflowTemplateSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().min(10).max(3000),
  eventTypeId: z.string().min(1),
  eventTypeLabel: z.string().min(2).max(80),
  version: z.number().int().positive(),
  status: z.enum(["draft", "active", "superseded", "archived"]),
  checkpointTemplates: z.array(checkpointTemplateSchema).min(1),
  automationRules: z.array(automationRuleSchema),
  immutable: z.boolean(),
  publishedAt: z.string().datetime().nullable(),
  publishedBy: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type WorkflowTemplate = z.infer<typeof workflowTemplateSchema>;

export const workflowTemplateSnapshotSchema = workflowTemplateSchema.pick({
  name: true,
  description: true,
  eventTypeId: true,
  eventTypeLabel: true,
  version: true,
  checkpointTemplates: true,
  automationRules: true,
});

export const workflowRunSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  workflowTemplateId: z.string().min(1),
  workflowVersion: z.number().int().positive(),
  status: z.enum(["active", "completed", "cancelled", "failed"]),
  inputSnapshot: z.record(z.string(), z.unknown()),
  templateSnapshot: workflowTemplateSnapshotSchema,
  checkpointIds: z.array(z.string()),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  failureReason: z.string().max(2000).nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type WorkflowRun = z.infer<typeof workflowRunSchema>;
