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

/**
 * Where the client is billed.
 *
 * QuickBooks works out US sales tax from the customer's address, and GR
 * Productions creates every customer with one for exactly that reason
 * (2026-10-01). Optional: a studio that bills no tax never needs it.
 * Mirrored in functions/src/crm/commands.ts (updateContact) and compared by
 * tests/quickbooks-invoice-lines.test.ts.
 */
export const billingAddressSchema = z.object({
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).nullable().default(null),
  city: z.string().trim().min(1).max(120),
  /** State or province: "NJ". */
  region: z.string().trim().max(80).nullable().default(null),
  postalCode: z.string().trim().max(20).nullable().default(null),
  /** ISO 3166-1 alpha-2. */
  country: z.string().trim().length(2).toUpperCase().default("US"),
});

export type BillingAddress = z.infer<typeof billingAddressSchema>;

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
  billingAddress: billingAddressSchema.nullable().optional(),
  archivedAt: z.string().datetime().nullable(),
});

export type Contact = z.infer<typeof contactSchema>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}
