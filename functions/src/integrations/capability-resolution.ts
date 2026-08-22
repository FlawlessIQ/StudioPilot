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
 * without a round trip through the client.
 *
 * `fallback` is a last resort and, on the paths that actually call a
 * provider, the wrong answer. The case it was written for — a tenant with
 * exactly one connected provider and no explicit routing — is already
 * handled by `resolveActiveProvider` as `sole_connected_provider`. What is
 * left when resolution fails is: nothing connected, two connected and no
 * choice made, or a choice pointing at something disconnected. Guessing in
 * any of those queues a job against a provider the studio has no
 * credentials for, and the first anyone hears of it is a failed provider
 * job some minutes later.
 *
 * So live paths should call `requireProviderForTenant`, which refuses. This
 * one remains for mock mode and for recording a provider name on a record
 * where nothing is actually dispatched.
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

/**
 * The provider for a capability, or a refusal naming why.
 *
 * For the paths that dispatch real work. The thrown codes are the same
 * vocabulary `resolveActiveProvider` returns, so the surface that catches
 * them can say something true: nothing connected, more than one and no
 * choice, or a choice that has gone stale.
 */
export async function requireProviderForTenant(
  db: Firestore,
  tenantId: string,
  capability: Capability,
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
  if (resolution.outcome === "resolved") return resolution.provider;
  throw new Error(
    `${capability.toUpperCase()}_${resolution.reason.toUpperCase()}`,
  );
}
