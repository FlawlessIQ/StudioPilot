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
    | SetCapabilityProviderResult
    | { error: string };
  if (!response.ok || "error" in result) {
    throw new Error(
      "error" in result ? result.error : "Could not change the connected provider.",
    );
  }
  return { persisted: true, result };
}
