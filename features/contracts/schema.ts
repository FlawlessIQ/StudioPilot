import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import { contractDocumentSchema } from "@/features/contracts/document";

/**
 * A contract record, as it is actually written.
 *
 * This schema had drifted from the writers: `provider` allowed only the two
 * signing vendors while a recorded signature writes `null`, and statuses,
 * `completionAuthority` and several provider fields were written everywhere
 * and declared nowhere. It now describes all four authors — a signing vendor's
 * webhook, a studio's recorded signature, an imported booking, and StudioCue's
 * own signing (`provider: "studiocue"`).
 */

export const contractStatusSchema = z.enum([
  "draft",
  "queued",
  "sent",
  "delivered",
  "viewed",
  "partially_signed",
  "completed",
  "declined",
  "voided",
  "expired",
  "failed",
  "superseded",
  "error",
]);

export const contractProviderSchema = z.enum(["docusign", "dropbox_sign", "studiocue"]);

/**
 * Who established that a contract is complete.
 *
 * Absent on a vendor-signed contract, for history's sake: those were written
 * before the field existed. `client_signed` is the couple's own act, captured
 * by StudioCue — signer evidence, not the studio's word (ADR 0006).
 * `manual_attested` and `imported` are the studio's word (ADR 0005).
 */
export const completionAuthoritySchema = z.enum([
  "client_signed",
  "manual_attested",
  "imported",
]);

export const contractSignerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().nullable(),
  role: z.string().min(1),
  order: z.number().int().positive(),
  status: z.string().min(1),
  signedAt: z.string().datetime().nullable().optional(),
});

/** The summary of one signature, held on the contract. The full record is in contractSignatures. */
export const contractSignatureSummarySchema = z.object({
  id: z.string().min(1),
  role: z.enum(["studio", "client"]),
  typedName: z.string().min(1),
  signedAt: z.string().datetime(),
});

export const contractSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  proposalId: z.string().nullable(),
  status: contractStatusSchema,
  provider: contractProviderSchema.nullable(),
  completionAuthority: completionAuthoritySchema.optional(),
  providerEnvelopeId: z.string().nullable(),
  providerState: z.string().optional(),
  testMode: z.boolean().optional(),
  templateId: z.string().nullable(),
  signers: z.array(contractSignerSchema),
  sentAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  signedDocumentId: z.string().nullable(),
  certificateDocumentId: z.string().nullable(),
  completionEvidence: z.record(z.string(), z.unknown()).nullable(),
  fileHash: z.string().nullable(),
  lastProviderEventId: z.string().nullable(),
  supersededAt: z.string().datetime().optional(),
  supersededBy: z.string().optional(),
  archivedAt: z.string().datetime().nullable(),
  // StudioCue-written contracts only.
  templateVersionId: z.string().optional(),
  document: contractDocumentSchema.optional(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  unresolvedFields: z.array(z.string()).optional(),
  mergeOverrides: z.record(z.string(), z.string()).optional(),
  signatures: z.array(contractSignatureSummarySchema).optional(),
  voidedAt: z.string().datetime().nullable().optional(),
  voidedBy: z.string().nullable().optional(),
  voidReason: z.string().nullable().optional(),
  lastReminderAt: z.string().datetime().nullable().optional(),
  remindersSent: z.number().int().nonnegative().optional(),
});

export type Contract = z.infer<typeof contractSchema>;

/**
 * One signature on a StudioCue contract. Written once, never updated or
 * deleted — firestore.rules refuses every client write, and no server path
 * updates it.
 */
export const contractSignatureSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  contractId: z.string().min(1),
  role: z.enum(["studio", "client"]),
  signerUid: z.string().min(1),
  signerEmail: z.string().email().nullable(),
  typedName: z.string().min(2).max(160),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  consentVersion: z.string().min(1),
  consentTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  authMethod: z.string().nullable(),
  emailVerified: z.boolean().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  signedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export type ContractSignature = z.infer<typeof contractSignatureSchema>;
