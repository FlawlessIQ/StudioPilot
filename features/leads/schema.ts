import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import { normalizeEmail, normalizePhone } from "@/features/contacts/schema";

export const leadStatusSchema = z.enum([
  "new",
  "reviewing",
  "qualified",
  "consultation_scheduled",
  "proposal_ready",
  "converted",
  "lost",
  "archived",
]);

export const eventServiceSchema = z.enum([
  "photography",
  "videography",
  "engagement_session",
  "second_shooter",
  "album",
  "prints",
  "corporate_licensing",
  "team_photos",
  "other",
]);

export const publicLeadIntakeSchema = z.object({
  tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  partnerName: z.string().trim().max(120).nullable().default(null),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(30),
  eventDate: z.string().date(),
  eventType: z.string().trim().min(2).max(80),
  venue: z.string().trim().max(160).nullable().default(null),
  city: z.string().trim().min(2).max(120),
  estimatedGuestCount: z.number().int().min(1).max(100000).nullable().default(null),
  servicesRequested: z.array(eventServiceSchema).min(1),
  budgetRange: z.string().trim().max(80).nullable().default(null),
  referralSource: z.string().trim().max(120).nullable().default(null),
  message: z.string().trim().min(10).max(5000),
  consent: z.literal(true),
  source: z.string().trim().max(120).default("public_inquiry"),
  honeypot: z.string().max(0).default(""),
});

export type PublicLeadIntake = z.infer<typeof publicLeadIntakeSchema>;

export const leadSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().nullable(),
  primaryContactId: z.string().min(1),
  status: leadStatusSchema,
  eventTypeId: z.string().min(1),
  eventTypeLabel: z.string().min(2).max(80),
  eventDate: z.string().date(),
  venue: z.string().max(160).nullable(),
  city: z.string().min(2).max(120),
  estimatedGuestCount: z.number().int().positive().nullable(),
  servicesRequested: z.array(eventServiceSchema).min(1),
  budgetRange: z.string().max(80).nullable(),
  referralSource: z.string().max(120).nullable(),
  message: z.string().min(10).max(5000),
  assignedUserId: z.string().nullable(),
  duplicateKey: z.string().min(1),
  duplicateOfLeadId: z.string().nullable(),
  availabilityStatus: z.enum(["available", "conflict", "unknown"]),
  aiSummary: z.string().max(2000).nullable(),
  missingInformation: z.array(z.string()).default([]),
  suggestedConsultationQuestions: z.array(z.string()).default([]),
  consentRecordedAt: z.string().datetime(),
  source: z.string().max(120),
  archivedAt: z.string().datetime().nullable(),
});

export type Lead = z.infer<typeof leadSchema>;

export function createLeadDuplicateKey(input: {
  email: string;
  phone: string;
  eventDate: string;
}): string {
  return [
    normalizeEmail(input.email),
    normalizePhone(input.phone),
    input.eventDate,
  ].join("|");
}

export function detectMissingLeadInformation(
  input: Pick<
    PublicLeadIntake,
    "venue" | "budgetRange" | "referralSource" | "estimatedGuestCount"
  >,
): string[] {
  const missing: string[] = [];
  if (!input.venue) missing.push("venue");
  if (!input.budgetRange) missing.push("budget range");
  if (!input.referralSource) missing.push("referral source");
  if (!input.estimatedGuestCount) missing.push("estimated guest count");
  return missing;
}
