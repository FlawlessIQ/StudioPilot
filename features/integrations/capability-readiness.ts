import {
  providerCapabilities,
  type IntegrationCapability,
  type IntegrationProvider,
} from "@/features/integrations/schema";
import {
  resolveActiveProvider,
  type CapabilitySelections,
  type RoutableConnection,
} from "@/features/integrations/routing";

/**
 * "Who does this, and can they do it right now?" — in the words a screen
 * needs to say it.
 *
 * The routing layer already answers which provider serves a capability for
 * a tenant, and the booking commands already use it. Nothing on any other
 * screen ever asked. So the proposal page could offer "Send for approval"
 * without mentioning that approval leads to a signature request, let alone
 * which provider sends it or whether that provider is connected — and a
 * studio with nothing connected found out when a provider job failed.
 *
 * This turns a resolution into a sentence and a state, so the surfaces that
 * are about to trigger a provider can say what will happen before the
 * button is pressed rather than after.
 */
export type CapabilityReadiness = {
  capability: IntegrationCapability;
  /** The provider that will handle it, when one is resolvable. */
  provider: IntegrationProvider | null;
  state: "ready" | "degraded" | "none_connected" | "ambiguous" | "selection_broken";
  /** One line naming what will happen, for the surface about to do it. */
  summary: string;
  /** What to do about it, when something needs doing. */
  remedy: string | null;
  /** True when work can proceed without a warning. */
  ok: boolean;
};

const PROVIDER_NAMES: Record<IntegrationProvider, string> = {
  google_calendar: "Google Calendar",
  zoom: "Zoom",
  docusign: "DocuSign",
  dropbox_sign: "Dropbox Sign",
  quickbooks: "QuickBooks",
  stripe: "Stripe",
  dropbox: "Dropbox",
};

export function providerName(provider: IntegrationProvider): string {
  return PROVIDER_NAMES[provider];
}

/** What the capability is for, said as an outcome rather than a noun. */
const CAPABILITY_WORK: Record<IntegrationCapability, string> = {
  signing: "send the agreement for signature",
  invoicing: "raise and track invoices",
  calendar: "put events on your calendar",
  meetings: "create meeting links",
  storage: "deliver files",
};

/** The providers a studio could connect for this, for the "none" case. */
function candidatesFor(capability: IntegrationCapability): string {
  const names = (
    Object.keys(providerCapabilities) as IntegrationProvider[]
  )
    .filter((provider) => providerCapabilities[provider].includes(capability))
    .map(providerName);
  if (names.length <= 1) return names[0] ?? "a provider";
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

export function capabilityReadiness(input: {
  capability: IntegrationCapability;
  connections: readonly RoutableConnection[];
  selections: CapabilitySelections | null;
}): CapabilityReadiness {
  const { capability, connections, selections } = input;
  const work = CAPABILITY_WORK[capability];
  const resolution = resolveActiveProvider({
    capability,
    connections,
    routing: selections ? { selections } : null,
  });

  if (resolution.outcome === "resolved") {
    const connection = connections.find(
      (entry) => entry.provider === resolution.provider,
    );
    const name = providerName(resolution.provider);
    // A degraded connection still resolves — the routing layer only checks
    // "connected" — so this is the one case where the resolution is right
    // and the answer is still "not yet".
    if (connection?.status === "degraded") {
      return {
        capability,
        provider: resolution.provider,
        state: "degraded",
        summary: `${name} is having trouble, so this may not go out.`,
        remedy: `Check the ${name} connection`,
        ok: false,
      };
    }
    return {
      capability,
      provider: resolution.provider,
      state: "ready",
      summary: `StudioCue will ${work} through ${name}.`,
      remedy: null,
      ok: true,
    };
  }

  if (resolution.reason === "ambiguous_multiple_providers") {
    return {
      capability,
      provider: null,
      state: "ambiguous",
      summary: `More than one connected app can ${work}, so StudioCue does not know which to use.`,
      remedy: "Choose one in Studio settings",
      ok: false,
    };
  }

  if (resolution.reason === "selected_provider_not_connected") {
    const chosen = selections?.[capability];
    const name = chosen ? providerName(chosen) : "The chosen app";
    return {
      capability,
      provider: chosen ?? null,
      state: "selection_broken",
      summary: `${name} is set to ${work} but is not connected.`,
      remedy: `Reconnect ${name}`,
      ok: false,
    };
  }

  return {
    capability,
    provider: null,
    state: "none_connected",
    summary: `Nothing is connected to ${work}, so this step stays manual.`,
    remedy: `Connect ${candidatesFor(capability)}`,
    ok: false,
  };
}
