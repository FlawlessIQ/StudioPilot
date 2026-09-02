import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
/**
 * The states a certificate actually reaches.
 *
 * `not_required`, `requirements_missing`, `ready_to_request` and `waived`
 * were declared here and never written by anything — grepping the whole repo
 * found no producer and no reader. They described a pre-request phase the
 * product never modelled, which is why the page could not answer "does this
 * job even need a certificate?": the states existed only in this union.
 *
 * Removed rather than wired up. Answering that question honestly needs no new
 * state — either a request exists for the job or it does not, and the page now
 * says so. Adding a project field the studio must remember to set would have
 * created an "unknown" that stays unknown for ever.
 */
export const coiStatusSchema = z.enum(["requested","awaiting_response","received","under_review","correction_required","approved","sent_to_venue","venue_acknowledged","failed"]);
export const insuranceRequirementSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), projectId: z.string(), status: coiStatusSchema,
  certificateHolder: z.string(), venueLegalName: z.string(), venueAddress: z.string(),
  eventDate: z.string().date(), coverageTypes: z.array(z.string()), requiredLimits: z.record(z.string(), z.number().nonnegative()),
  additionalInsuredWording: z.string().nullable(), waiverOfSubrogation: z.boolean(),
  primaryNoncontributory: z.boolean(), specialInstructions: z.string().nullable(),
  submissionEmail: z.string().email(), dueDate: z.string().date(),
  approvedAt: z.string().datetime().nullable(), approvedBy: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});
export const insuranceRequestSchema = auditFieldsSchema.extend({
  id: z.string(), tenantId: z.string(), projectId: z.string(), requirementId: z.string(),
  status: coiStatusSchema, replyTokenHash: z.string(), inboundMessageId: z.string().nullable(),
  documentId: z.string().nullable(), extractedData: z.record(z.string(), z.unknown()).nullable(),
  discrepancies: z.array(z.object({ field: z.string(), expected: z.string(), extracted: z.string(), severity: z.enum(["info","warning","blocking"]) })),
  humanDecision: z.enum(["pending","approved","rejected"]).default("pending"),
  requestedAt: z.string().datetime().nullable(), receivedAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});
export type InsuranceRequirement = z.infer<typeof insuranceRequirementSchema>;
export type InsuranceRequest = z.infer<typeof insuranceRequestSchema>;
