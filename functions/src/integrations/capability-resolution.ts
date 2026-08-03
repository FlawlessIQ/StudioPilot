import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

// Mirrors features/integrations/schema.ts + features/integrations/routing.ts.
// functions/ is a separate package (own tsconfig, no path alias to the
// root), so these are intentionally re-declared here rather than imported —
// the same pattern oauth.ts already uses for its provider list. This is the
// canonical copy within functions/; other functions/src modules that need
// the capability/provider vocabulary or resolution should import it from
// here rather than re-declaring it again.
export const capabilitySchema = z.enum([
  "signing",
  "invoicing",
  "calendar",
  "meetings",
  "storage",
]);
export type Capability = z.infer<typeof capabilitySchema>;

export const providerSchema = z.enum([
  "google_calendar",
  "zoom",
  "docusign",
  "dropbox_sign",
  "quickbooks",
  "stripe",
  "dropbox",
]);
export type Provider = z.infer<typeof providerSchema>;

export const providerCapabilities: Readonly<Record<Provider, readonly Capability[]>> = {
  google_calendar: ["calendar"],
  zoom: ["meetings"],
  docusign: ["signing"],
  dropbox_sign: ["signing"],
  quickbooks: ["invoicing"],
  stripe: ["invoicing"],
  dropbox: ["storage"],
};

type RoutableConnection = {
  provider: Provider;
  status: string;
  archivedAt: string | null;
};

function isUsable(connection: RoutableConnection): boolean {
  return connection.status === "connected" && connection.archivedAt === null;
}

function connectedProvidersFor(
  capability: Capability,
  connections: readonly RoutableConnection[],
): Provider[] {
  const usable = connections.filter(isUsable);
  const seen = new Set<Provider>();
  for (const connection of usable) {
    if (providerCapabilities[connection.provider].includes(capability)) {
      seen.add(connection.provider);
    }
  }
  return [...seen];
}

export type ProviderResolution =
  | { outcome: "resolved"; provider: Provider; reason: "explicit_selection" | "sole_connected_provider" }
  | { outcome: "unresolved"; reason: "no_connected_provider" | "ambiguous_multiple_providers" | "selected_provider_not_connected" };

// Same precedence as features/integrations/routing.ts#resolveActiveProvider:
// explicit selection (if still connected) > sole connected provider > unresolved.
export function resolveActiveProvider(input: {
  capability: Capability;
  selections: Partial<Record<Capability, Provider | null>> | null;
  connections: readonly RoutableConnection[];
}): ProviderResolution {
  const { capability, selections, connections } = input;
  const candidates = connectedProvidersFor(capability, connections);

  const explicit = selections?.[capability] ?? null;
  if (explicit !== null) {
    if (candidates.includes(explicit)) {
      return { outcome: "resolved", provider: explicit, reason: "explicit_selection" };
    }
    return { outcome: "unresolved", reason: "selected_provider_not_connected" };
  }

  const [sole, ...rest] = candidates;
  if (sole && rest.length === 0) {
    return { outcome: "resolved", provider: sole, reason: "sole_connected_provider" };
  }
  if (candidates.length === 0) {
    return { outcome: "unresolved", reason: "no_connected_provider" };
  }
  return { outcome: "unresolved", reason: "ambiguous_multiple_providers" };
}

/**
 * Firestore-backed resolution for one tenant + capability, for use inside
 * command/webhook handlers that need to know "which provider is active"
 * without a round trip through the client. Falls back to `fallback` when
 * resolution is unresolved, so existing single-provider tenants (nothing
 * explicitly routed, exactly one provider ever connected) keep behaving
 * exactly as they did before a capability had more than one option.
 */
export async function resolveProviderForTenant(
  db: Firestore,
  tenantId: string,
  capability: Capability,
  fallback: Provider,
): Promise<Provider> {
  const [routingDoc, connectionsSnapshot] = await Promise.all([
    db.doc(`integrationRouting/${tenantId}`).get(),
    db.collection("integrationConnections").where("tenantId", "==", tenantId).get(),
  ]);
  const selections = (routingDoc.data()?.selections ?? null) as
    | Partial<Record<Capability, Provider | null>>
    | null;
  const connections: RoutableConnection[] = connectionsSnapshot.docs.map((doc) => ({
    provider: doc.get("provider") as Provider,
    status: String(doc.get("status")),
    archivedAt: (doc.get("archivedAt") as string | null) ?? null,
  }));
  const resolution = resolveActiveProvider({ capability, selections, connections });
  return resolution.outcome === "resolved" ? resolution.provider : fallback;
}
