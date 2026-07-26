import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const questionnaireFieldTypeSchema = z.enum([
  "text", "long_text", "email", "phone", "date", "time", "address",
  "dropdown", "multi_select", "radio", "checkbox", "file", "contact",
  "repeating_group", "acknowledgement", "information",
]);
export const questionnaireFieldSchema = z.object({
  id: z.string().min(1), label: z.string().min(1), type: questionnaireFieldTypeSchema,
  required: z.boolean(), locked: z.boolean(), internalOnly: z.boolean(),
  options: z.array(z.string()), conditionalOn: z.object({ fieldId: z.string(), equals: z.unknown() }).nullable(),
});
export const questionnaireTemplateSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), name: z.string(), eventTypeId: z.string(),
  version: z.number().int().positive(), status: z.enum(["draft", "active", "archived"]),
  sections: z.array(z.object({ id: z.string(), title: z.string(), fields: z.array(questionnaireFieldSchema) })),
  dueDaysBeforeEvent: z.number().int().nonnegative(), reminderDaysBeforeDue: z.array(z.number().int().nonnegative()),
  archivedAt: z.string().datetime().nullable(),
});
export const questionnaireResponseSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), projectId: z.string(), templateId: z.string(),
  templateVersion: z.number().int().positive(), status: z.enum(["not_started", "in_progress", "submitted", "locked"]),
  answers: z.record(z.string(), z.unknown()), completionPercent: z.number().min(0).max(100),
  submittedAt: z.string().datetime().nullable(), archivedAt: z.string().datetime().nullable(),
});
export type QuestionnaireTemplate = z.infer<typeof questionnaireTemplateSchema>;
export type QuestionnaireResponse = z.infer<typeof questionnaireResponseSchema>;
