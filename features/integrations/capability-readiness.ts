import {
  isOfferedProvider,
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

/**
 * What "nothing is connected" actually means for this capability.
 *
 * Every one of these used to end "so this step stays manual", which reads as
 * reassurance and is not the same claim in each case. For signing it
 * undersells a path StudioCue has — a studio that sends its own agreement
 * can record the signature here and the booking proceeds normally — and
 * nothing on the page said so, so the honest answer to "can I use this
 * without Dropbox Sign?" looked like no. For invoicing it oversells: there
 * is no way to record a retainer StudioCue did not raise, so the booking
 * gate never sees a paid retainer and the job cannot be confirmed at all.
 * Saying "stays manual" to both hid a working path behind one and a dead
 * end behind the other.
 */
const CAPABILITY_WITHOUT_PROVIDER: Record<IntegrationCapability, string> = {
  signing:
    "Send your own agreement and record the signature on the booking — StudioCue books the job either way.",
  invoicing:
    "StudioCue cannot track a retainer it did not raise, so the booking cannot be confirmed until one is connected.",
  calendar: "Events stay in your own calendar and StudioCue will not add them.",
  meetings: "You will need to paste your own meeting link.",
  storage: "Files stay wherever you put them and StudioCue will not deliver them.",
};

/**
 * The providers a studio could actually connect for this.
 *
 * Offered ones only. Naming Stripe in "Connect QuickBooks or Stripe" sends
 * someone to a settings page that does not list Stripe, because Stripe
 * Connect is not offered yet — a remedy pointing at something that is not
 * there is worse than a shorter one.
 */
function candidatesFor(capability: IntegrationCapability): string {
  const names = (Object.keys(providerCapabilities) as IntegrationProvider[])
    .filter(
      (provider) =>
        isOfferedProvider(provider) &&
        providerCapabilities[provider].includes(capability),
    )
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
    summary: `Nothing is connected to ${work}. ${CAPABILITY_WITHOUT_PROVIDER[capability]}`,
    remedy: `Connect ${candidatesFor(capability)}`,
    ok: false,
  };
}
