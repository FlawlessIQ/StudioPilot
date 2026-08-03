import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const invoiceStatusSchema = z.enum([
  "draft",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "voided",
  "refunded",
  "error",
]);

export const invoiceReferenceSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["retainer", "final", "adjustment"]),
  provider: z.enum(["quickbooks", "stripe"]),
  providerInvoiceId: z.string().min(1),
  providerCustomerId: z.string().min(1),
  status: invoiceStatusSchema,
  currency: z.string().length(3),
  amountCents: z.number().int().positive().safe(),
  balanceCents: z.number().int().nonnegative().safe(),
  dueDate: z.string().date(),
  hostedUrl: z.string().url().nullable(),
  lastSyncedAt: z.string().datetime(),
  lastProviderEventId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type InvoiceReference = z.infer<typeof invoiceReferenceSchema>;
