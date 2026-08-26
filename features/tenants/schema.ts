import { z } from "zod";

export const auditFieldsSchema = z.object({
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
});

export const tenantSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  businessName: z.string().min(2).max(120),
  legalName: z.string().min(2).max(160),
  brandName: z.string().min(2).max(120),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  dateFormat: z.string().min(1),
  status: z.enum(["trial", "active", "past_due", "suspended", "cancelled"]),
  subscriptionPlan: z.enum(["studio", "multi_brand"]),
  archivedAt: z.string().datetime().nullable(),
});

export type Tenant = z.infer<typeof tenantSchema>;
