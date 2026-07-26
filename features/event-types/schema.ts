import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const eventTypeCategorySchema = z.enum([
  "wedding",
  "corporate",
  "sports",
  "school",
  "business",
  "other",
]);

export const eventTypeTemplateSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  category: eventTypeCategorySchema,
  description: z.string().max(1000),
  defaultWorkflowTemplateId: z.string().nullable(),
  defaultQuestionnaireTemplateId: z.string().nullable(),
  requiresGuardian: z.boolean(),
  active: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable(),
});

export type EventTypeTemplate = z.infer<typeof eventTypeTemplateSchema>;
