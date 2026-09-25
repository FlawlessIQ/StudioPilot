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

/**
 * Every message here is read by somebody enquiring about their wedding.
 *
 * The `consent` note below has said so since it was written, and the reasoning
 * never reached the fields beside it. On 2026-09-22 the public form refused to
 * submit four times in a row showing "Too small: expected string to have >=2
 * characters" against City — Zod's own words, on the most public page in the
 * product. A couple reads that and emails somebody else.
 */
export const publicLeadIntakeSchema = z.object({
  tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
  firstName: z.string().trim().min(1, "Tell us your first name.").max(80),
  lastName: z.string().trim().min(1, "Tell us your last name.").max(80),
  partnerName: z.string().trim().max(120).nullable().default(null),
  email: z
    .string()
    .trim()
    .email("Check the email address — this is where the studio will reply."),
  phone: z
    .string()
    .trim()
    .min(7, "Add a phone number the studio can reach you on.")
    .max(30),
  eventDate: z.string().date("Pick the date of your event."),
  eventType: z.string().trim().min(2).max(80),
  venue: z.string().trim().max(160).nullable().default(null),
  city: z
    .string()
    .trim()
    .min(2, "Which city or town is the event in?")
    .max(120),
  estimatedGuestCount: z.number().int().min(1).max(100000).nullable().default(null),
  servicesRequested: z.array(eventServiceSchema).min(1),
  budgetRange: z.string().trim().max(80).nullable().default(null),
  referralSource: z.string().trim().max(120).nullable().default(null),
  message: z
    .string()
    .trim()
    .min(10, "Tell the studio a little about the day — a sentence is plenty.")
    .max(5000),
  // Ticked by the person, not for them: the box used to arrive checked, so the
  // only way to withhold consent was to notice it and untick it. The message
  // matters because it is now reachable — "Invalid literal value" is not
  // something to show someone enquiring about their wedding.
  consent: z.boolean().refine((given) => given === true, {
    message: "Please tick the box so we know we may reply to you.",
  }),
  source: z.string().trim().max(120).default("public_inquiry"),
  honeypot: z.string().max(0).default(""),
});

export type PublicLeadIntake = z.infer<typeof publicLeadIntakeSchema>;

/** Where a captured value came from — shown on the review card so a studio can tell stated from inferred. */
export const leadFieldSourceSchema = z.enum(["form", "header", "message", "studio"]);

/**
 * A lead as stored. Two front doors write it: the public intake form (every
 * field required, the couple typed them) and inbox capture (a contact-form
 * notification that asked for a name and an email and little else). So the
 * date, city and contact are nullable here, and `needsConfirmation` marks a
 * capture the reader wasn't sure was an inquiry at all.
 */
export const leadSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().nullable(),
  primaryContactId: z.string().min(1).nullable(),
  status: leadStatusSchema,
  eventTypeId: z.string().min(1),
  eventTypeLabel: z.string().min(2).max(80),
  eventDate: z.string().date().nullable(),
  venue: z.string().max(160).nullable(),
  city: z.string().max(120).nullable(),
  estimatedGuestCount: z.number().int().positive().nullable(),
  servicesRequested: z.array(eventServiceSchema).min(1),
  budgetRange: z.string().max(80).nullable(),
  referralSource: z.string().max(120).nullable(),
  message: z.string().max(5000),
  assignedUserId: z.string().nullable(),
  duplicateKey: z.string().min(1),
  duplicateOfLeadId: z.string().nullable(),
  availabilityStatus: z.enum(["available", "conflict", "unknown"]),
  aiSummary: z.string().max(2000).nullable(),
  missingInformation: z.array(z.string()).default([]),
  suggestedConsultationQuestions: z.array(z.string()).default([]),
  consentRecordedAt: z.string().datetime().nullable(),
  source: z.string().max(120),
  archivedAt: z.string().datetime().nullable(),
  // Inbox capture. Absent on leads from the public form.
  displayName: z.string().max(200).optional(),
  firstName: z.string().max(80).nullable().optional(),
  lastName: z.string().max(80).nullable().optional(),
  partnerName: z.string().max(120).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  ceremonyTime: z.string().max(40).nullable().optional(),
  needsConfirmation: z.boolean().optional(),
  formBuilder: z.string().max(40).optional(),
  formBuilderLabel: z.string().max(80).optional(),
  formName: z.string().max(160).nullable().optional(),
  captureRoute: z.enum(["forward", "graph", "gmail"]).optional(),
  captureId: z.string().optional(),
  fieldProvenance: z
    .record(z.string(), z.object({ source: leadFieldSourceSchema, label: z.string().nullable().optional() }))
    .optional(),
  rawFormFields: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  enrichmentPending: z.boolean().optional(),
  inquiryCount: z.number().int().min(1).optional(),
  lastInquiryAt: z.string().datetime().optional(),
  conversationId: z.string().nullable().optional(),
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
