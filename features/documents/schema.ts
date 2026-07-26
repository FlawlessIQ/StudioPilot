import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const documentSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  category: z.enum(["proposal", "contract", "invoice", "schedule", "coi", "crew", "delivery", "other"]),
  name: z.string().min(1).max(240),
  provider: z.enum(["dropbox", "gcs", "docusign"]),
  providerFileId: z.string().min(1),
  revision: z.string().nullable(),
  canonicalPath: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
  visibility: z.enum(["studio", "client", "crew", "shared"]),
  immutable: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
});

export type DocumentRecord = z.infer<typeof documentSchema>;
