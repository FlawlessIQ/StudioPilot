import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

export const integrationProviderSchema = z.enum([
  "google_calendar",
  "zoom",
  "docusign",
  "dropbox_sign",
  "quickbooks",
  "stripe",
  "dropbox",
]);

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;

// A capability is a job a feature needs done (send a contract for signature,
// create an invoice, ...). Multiple providers can serve the same capability;
// the studio picks which connected provider is active for each one via
// features/integrations/routing.ts.
export const integrationCapabilitySchema = z.enum([
  "signing",
  "invoicing",
  "calendar",
  "meetings",
  "storage",
]);

export type IntegrationCapability = z.infer<typeof integrationCapabilitySchema>;

// Which capabilities each provider can serve. A provider may serve more than
// one capability; a capability may be served by more than one provider.
export const providerCapabilities: Readonly<
  Record<IntegrationProvider, readonly IntegrationCapability[]>
> = {
  google_calendar: ["calendar"],
  zoom: ["meetings"],
  docusign: ["signing"],
  dropbox_sign: ["signing"],
  quickbooks: ["invoicing"],
  stripe: ["invoicing"],
  dropbox: ["storage"],
};

/**
 * Providers StudioCue actually offers a studio today.
 *
 * DocuSign stays implemented server-side so an approved production
 * integration can be restored later, and Stripe Connect needs platform
 * onboarding that has not happened — so neither is shown, connectable, or
 * choosable. That was a filter inside the settings component, which meant
 * only that screen knew about it.
 *
 * Everything else — the capability note on the proposal page, and
 * critically the server resolving which provider signs a contract — worked
 * from the raw connection list. A tenant carrying a leftover `docusign`
 * connection therefore looked unambiguous in settings ("Dropbox Sign") and
 * ambiguous everywhere else, and the booking command resolved it by falling
 * back to DocuSign: sending contracts through a provider the studio cannot
 * see, has not chosen, and could not have connected.
 *
 * Being offered is a property of the product, not of one screen.
 */
export const offeredProviders: ReadonlySet<IntegrationProvider> = new Set([
  "google_calendar",
  "zoom",
  "dropbox_sign",
  "quickbooks",
  "dropbox",
]);

export function isOfferedProvider(provider: IntegrationProvider): boolean {
  return offeredProviders.has(provider);
}

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
