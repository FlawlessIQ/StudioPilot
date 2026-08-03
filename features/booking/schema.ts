import { z } from "zod";

export const bookingGateEvidenceSchema = z.object({
  contractCompleted: z.boolean(),
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
    source: z.enum(["docusign", "dropbox_sign", "quickbooks", "calendar", "project", "approved_exception"]),
  })),
  blockers: z.array(z.string()),
  evaluatedAt: z.string().datetime(),
  rulesVersion: z.number().int().positive(),
});

export type BookingGateEvidence = z.infer<typeof bookingGateEvidenceSchema>;
export type BookingGateResult = z.infer<typeof bookingGateResultSchema>;
