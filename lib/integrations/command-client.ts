"use client";

import { getOptionalAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import type {
  IntegrationCapability,
  IntegrationProvider,
} from "@/features/integrations/schema";

export type SetCapabilityProviderResult = {
  capability: IntegrationCapability;
  provider: IntegrationProvider | null;
};

/**
 * Sets which connected provider is active for a capability (e.g. "use
 * Dropbox Sign for signing"). Shares the same Functions deployment as
 * integrationOAuth (NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL) — same domain,
 * same private endpoint group.
 */
export async function setCapabilityProvider(
  capability: IntegrationCapability,
  provider: IntegrationProvider | null,
  tenantId: string,
): Promise<{ persisted: boolean; result: SetCapabilityProviderResult }> {
  const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
  if (!endpoint) {
    // Non-persisting preview mode: reflect the requested choice in the UI
    // without a configured Functions deployment to write it.
    return { persisted: false, result: { capability, provider } };
  }

  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before changing a connected provider.");
  if (!tenantId) {
    throw new Error("No active studio membership was found.");
  }

  const appCheckToken = await getOptionalAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/integrationsCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        type: "setCapabilityProvider",
        tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { capability, provider },
      }),
    },
  );
  const result = (await response.json()) as
    SetCapabilityProviderResult | { error: string };
  if (!response.ok || "error" in result) {
    throw new Error(
      "error" in result
        ? result.error
        : "Could not change the connected provider.",
    );
  }
  return { persisted: true, result };
}

export type SigningTemplate = { id: string; name: string };

export type SigningTemplateList = {
  provider: IntegrationProvider | null;
  /** False when the resolved provider has no template listing to offer. */
  listable: boolean;
  templates: SigningTemplate[];
  /** Set when signing could not be resolved at all, e.g. nothing connected. */
  unavailable?: string;
};

/**
 * The agreement templates the studio's signing provider holds.
 *
 * Sending a contract needs a provider template id. Before this the only way
 * to supply one was to copy a GUID out of Dropbox Sign for every project,
 * so this exists to let a person pick by name instead.
 */
export async function listSigningTemplates(
  tenantId: string,
): Promise<SigningTemplateList> {
  const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
  if (!endpoint) {
    return {
      provider: null,
      listable: false,
      templates: [],
      unavailable: "PREVIEW_MODE",
    };
  }
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in to load agreement templates.");
  const appCheckToken = await getOptionalAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/signingTemplatesQuery`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({ tenantId }),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "Agreement templates could not be loaded."),
    );
  }
  return payload as unknown as SigningTemplateList;
}

export type ContractTemplateResult = {
  templateId: string | null;
  templateName: string | null;
};

/** Saves the studio-wide default agreement template. */
export async function setContractTemplate(
  input: { templateId: string | null; templateName: string | null },
  tenantId: string,
): Promise<{ persisted: boolean; result: ContractTemplateResult }> {
  const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
  if (!endpoint) return { persisted: false, result: input };
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before changing the agreement template.");
  const appCheckToken = await getOptionalAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/integrationsCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        type: "setContractTemplate",
        tenantId,
        idempotencyKey: crypto.randomUUID(),
        input,
      }),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(payload.error ?? "The agreement template could not be saved."),
    );
  }
  return {
    persisted: true,
    result: payload as unknown as ContractTemplateResult,
  };
}

/**
 * Turns a provider's test mode on or off.
 *
 * Test-mode signatures are watermarked and not legally binding, so this is
 * stored on the connection and surfaced wherever a contract is about to be
 * sent — never a silent environment setting.
 */
export async function setProviderTestMode(
  provider: IntegrationProvider,
  testMode: boolean,
  tenantId: string,
): Promise<{
  persisted: boolean;
  result: { provider: IntegrationProvider; testMode: boolean };
}> {
  const endpoint = process.env.NEXT_PUBLIC_INTEGRATION_FUNCTIONS_URL;
  if (!endpoint) return { persisted: false, result: { provider, testMode } };
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before changing test mode.");
  const appCheckToken = await getOptionalAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/integrationsCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify({
        type: "setProviderTestMode",
        tenantId,
        idempotencyKey: crypto.randomUUID(),
        input: { provider, testMode },
      }),
    },
  );
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? "Test mode could not be changed."));
  }
  return { persisted: true, result: { provider, testMode } };
}
