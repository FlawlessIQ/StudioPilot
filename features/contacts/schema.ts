import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const contactTypeSchema = z.enum([
  "client",
  "prospect",
  "vendor",
  "venue",
  "planner",
  "insurance_agent",
  "corporate_contact",
  "guardian",
  "other",
]);

export const contactSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(160),
  email: z.string().email().nullable(),
  normalizedEmail: z.string().email().nullable(),
  phone: z.string().max(30).nullable(),
  normalizedPhone: z.string().max(20).nullable(),
  company: z.string().trim().max(160).nullable(),
  contactTypes: z.array(contactTypeSchema).min(1),
  projectIds: z.array(z.string()).default([]),
  portalUserId: z.string().nullable(),
  marketingConsent: z.boolean(),
  notes: z.string().max(5000).nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type Contact = z.infer<typeof contactSchema>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}
