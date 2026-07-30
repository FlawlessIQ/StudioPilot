import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
export const scheduleStatusSchema = z.enum(["draft","internal_review","client_review","changes_requested","approved","published","superseded"]);
export const scheduleItemSchema = z.object({
  id: z.string(), startAt: z.string().datetime(), endAt: z.string().datetime(),
  title: z.string().min(1), description: z.string(), location: z.string().nullable(),
  address: z.string().nullable(), travelMinutes: z.number().int().nonnegative(),
  photographerIds: z.array(z.string()), participants: z.array(z.string()),
  vendorContactIds: z.array(z.string()), equipment: z.array(z.string()), notes: z.string().nullable(),
  visibility: z.enum(["studio","client","crew","shared"]), blockingIssues: z.array(z.string()),
  sourceReferences: z.array(z.object({
    type: z.enum(["project_fact","questionnaire_answer","timing_rule","package_fact","crew_fact","assumption"]),
    sourceId: z.string().min(1),
    label: z.string().min(1),
  })).default([]),
});
export const scheduleSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), projectId: z.string(), version: z.number().int().positive(),
  status: scheduleStatusSchema, timezone: z.string(), items: z.array(scheduleItemSchema),
  approvalState: z.enum(["none","client_pending","client_approved","changes_requested"]),
  publishedAt: z.string().datetime().nullable(), approvedBy: z.string().nullable(),
  pdfDocumentId: z.string().nullable(), dropboxDocumentId: z.string().nullable(),
  supersedesId: z.string().nullable(), immutable: z.boolean(), archivedAt: z.string().datetime().nullable(),
});
export const aiScheduleDraftSchema = z.object({
  items: z.array(scheduleItemSchema.omit({ id: true })),
  assumptions: z.array(z.string()), missingInformation: z.array(z.string()),
  conflicts: z.array(z.string()), risks: z.array(z.string()), suggestedQuestions: z.array(z.string()),
});
export type Schedule = z.infer<typeof scheduleSchema>;
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;
export type AiScheduleDraft = z.infer<typeof aiScheduleDraftSchema>;
