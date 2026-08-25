import { z } from "zod";

export const bookingGateEvidenceSchema = z.object({
  contractCompleted: z.boolean(),
  /**
   * The signature happened outside StudioCue and a studio owner has said so.
   *
   * Signing providers charge for API access, and a studio that signs by
   * email could not move a project past CONTRACT_PENDING at all — the
   * transition is evidence-controlled and only a provider webhook ever
   * wrote it. Payment already had this escape hatch in
   * `retainerExceptionApproved`; signing did not.
   *
   * Kept as its own field rather than folded into contractCompleted so the
   * gate can name which authority satisfied the requirement. A human
   * attesting is a legitimate authority; it is not the same claim as a
   * provider verifying, and the record must not blur them.
   */
  contractAttestedManually: z.boolean().default(false),
  retainerInvoiceCreated: z.boolean(),
  retainerSatisfied: z.boolean(),
  retainerExceptionApproved: z.boolean(),
  eventDateAvailable: z.boolean(),
  requiredContactsComplete: z.boolean(),
});

export const bookingGateResultSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  passed: z.boolean(),
  requirements: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    passed: z.boolean(),
    source: z.enum(["docusign", "dropbox_sign", "quickbooks", "calendar", "project", "approved_exception", "manual_attestation"]),
  })),
  blockers: z.array(z.string()),
  evaluatedAt: z.string().datetime(),
  rulesVersion: z.number().int().positive(),
});

export type BookingGateEvidence = z.infer<typeof bookingGateEvidenceSchema>;
export type BookingGateResult = z.infer<typeof bookingGateResultSchema>;
