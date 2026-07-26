import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const contractStatusSchema = z.enum([
  "draft",
  "sent",
  "delivered",
  "viewed",
  "partially_signed",
  "completed",
  "declined",
  "voided",
  "expired",
  "error",
]);

export const contractSignerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["primary_client", "secondary_client", "studio", "corporate", "guardian"]),
  order: z.number().int().positive(),
  status: z.string().min(1),
});

export const contractSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  proposalId: z.string().nullable(),
  status: contractStatusSchema,
  provider: z.literal("docusign"),
  providerEnvelopeId: z.string().min(1),
  templateId: z.string().min(1),
  signers: z.array(contractSignerSchema).min(1),
  sentAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  signedDocumentId: z.string().nullable(),
  certificateDocumentId: z.string().nullable(),
  completionEvidence: z.record(z.string(), z.unknown()).nullable(),
  fileHash: z.string().nullable(),
  lastProviderEventId: z.string().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export type Contract = z.infer<typeof contractSchema>;
