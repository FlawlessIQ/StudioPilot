import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const integrationProviderSchema = z.enum([
  "google_calendar",
  "zoom",
  "docusign",
  "quickbooks",
  "dropbox",
]);

export const integrationConnectionSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  provider: integrationProviderSchema,
  status: z.enum(["connected", "degraded", "disconnected", "error"]),
  providerAccountId: z.string().nullable(),
  displayName: z.string().nullable(),
  encryptedCredentialRef: z.string().nullable(),
  selectedResourceId: z.string().nullable(),
  scopes: z.array(z.string()),
  connectedAt: z.string().datetime().nullable(),
  lastHealthCheckAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  mockMode: z.boolean(),
  archivedAt: z.string().datetime().nullable(),
});

export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
