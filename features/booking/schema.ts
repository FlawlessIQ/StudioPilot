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
  /**
   * The retainer arrived outside StudioCue and a studio owner has said so.
   *
   * The mirror of `contractAttestedManually`, and needed for the same
   * reason: with no invoicing provider connected StudioCue cannot raise a
   * retainer, so it can never see one paid, so the gate never passes and
   * the booking cannot be confirmed at all. A studio taking a bank
   * transfer had no way through.
   *
   * Distinct from `retainerExceptionApproved`, which is the opposite
   * claim. An exception says the money has not arrived and the studio is
   * proceeding regardless; an attestation says it has arrived and StudioCue
   * was not the one to collect it. Folding them together would let a
   * waiver read as a payment in the audit record.
   */
  retainerAttestedManually: z.boolean().default(false),
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
