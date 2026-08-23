import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import {
  integrationProviderSchema,
  offeredProviders,
  providerCapabilities,
  type IntegrationCapability,
  type IntegrationProvider,
} from "@/features/integrations/schema";

// The studio's explicit choice of "which connected provider handles this
// capability", per tenant. A capability with no entry (or a null entry) has
// not been explicitly chosen and falls back to auto-resolution. Modeled as
// named optional fields (not z.record keyed by the capability enum) because
// a Zod enum-keyed record requires every key to be present; this map is
// meant to hold only the capabilities the studio has actually chosen.
export const capabilitySelectionsSchema = z.object({
  signing: integrationProviderSchema.nullable().optional(),
  invoicing: integrationProviderSchema.nullable().optional(),
  calendar: integrationProviderSchema.nullable().optional(),
  meetings: integrationProviderSchema.nullable().optional(),
  storage: integrationProviderSchema.nullable().optional(),
}) satisfies z.ZodType<Partial<Record<IntegrationCapability, IntegrationProvider | null>>>;

export const capabilityRoutingSchema = auditFieldsSchema.extend({
  tenantId: z.string().min(1),
  selections: capabilitySelectionsSchema,
});

export type CapabilitySelections = z.infer<typeof capabilitySelectionsSchema>;
export type CapabilityRouting = z.infer<typeof capabilityRoutingSchema>;

export type RoutableConnection = {
  provider: IntegrationProvider;
  status: "connected" | "degraded" | "disconnected" | "error";
  archivedAt: string | null;
};

export type ProviderResolution =
  | { outcome: "resolved"; provider: IntegrationProvider; reason: "explicit_selection" | "sole_connected_provider" }
  | { outcome: "unresolved"; reason: "no_connected_provider" | "ambiguous_multiple_providers" | "selected_provider_not_connected" };

function isUsable(
  connection: RoutableConnection,
  offered: ReadonlySet<IntegrationProvider>,
): boolean {
  // A provider the product does not offer cannot be the answer, however
  // connected its record looks. A leftover DocuSign connection is residue a
  // studio can neither see nor manage, and routing on it sent contracts
  // through a provider nobody chose.
  return (
    connection.status === "connected" &&
    connection.archivedAt === null &&
    offered.has(connection.provider)
  );
}

function connectedProvidersFor(
  capability: IntegrationCapability,
  connections: readonly RoutableConnection[],
  offered: ReadonlySet<IntegrationProvider>,
): IntegrationProvider[] {
  const usable = connections.filter((connection) =>
    isUsable(connection, offered),
  );
  const seen = new Set<IntegrationProvider>();
  for (const connection of usable) {
    if (providerCapabilities[connection.provider].includes(capability)) {
      seen.add(connection.provider);
    }
  }
  return [...seen];
}

/**
 * Resolve which provider is active for a capability, for one tenant.
 *
 * Precedence:
 *  1. An explicit selection, if that provider is still connected and still
 *     serves the capability (a studio may disconnect a provider it had
 *     selected; the selection does not silently resurrect it).
 *  2. If exactly one connected provider serves the capability, use it
 *     automatically — this keeps existing single-provider tenants working
 *     with no configuration step.
 *  3. Otherwise unresolved: zero connected providers (nothing to route to)
 *     or more than one with no explicit choice (ambiguous).
 *
 * `offered` narrows the field to what the product actually sells today and
 * defaults to exactly that. It is a parameter rather than a hard-coded
 * filter for one reason: with the current catalogue every capability has a
 * single offered provider, so a resolver that always applied it could never
 * reach its own ambiguity branch in a test. Production callers take the
 * default and cannot forget it; the tests for the algebra pass a wider set.
 */
export function resolveActiveProvider(input: {
  capability: IntegrationCapability;
  routing: Pick<CapabilityRouting, "selections"> | null;
  connections: readonly RoutableConnection[];
  offered?: ReadonlySet<IntegrationProvider>;
}): ProviderResolution {
  const { capability, routing, connections, offered = offeredProviders } = input;
  const candidates = connectedProvidersFor(capability, connections, offered);

  const explicit = routing?.selections[capability] ?? null;
  if (explicit !== null) {
    if (candidates.includes(explicit)) {
      return { outcome: "resolved", provider: explicit, reason: "explicit_selection" };
    }
    return { outcome: "unresolved", reason: "selected_provider_not_connected" };
  }

  if (candidates.length === 1) {
    return { outcome: "resolved", provider: candidates[0], reason: "sole_connected_provider" };
  }
  if (candidates.length === 0) {
    return { outcome: "unresolved", reason: "no_connected_provider" };
  }
  return { outcome: "unresolved", reason: "ambiguous_multiple_providers" };
}

/**
 * All providers currently eligible to be selected for a capability — i.e.
 * connected and capable of serving it. Used to populate a "use for X"
 * selector in the UI.
 */
export function eligibleProvidersFor(
  capability: IntegrationCapability,
  connections: readonly RoutableConnection[],
  offered: ReadonlySet<IntegrationProvider> = offeredProviders,
): IntegrationProvider[] {
  return connectedProvidersFor(capability, connections, offered);
}
