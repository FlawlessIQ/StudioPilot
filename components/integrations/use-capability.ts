"use client";

import { useEffect, useState } from "react";
import {
  capabilityReadiness,
  type CapabilityReadiness,
} from "@/features/integrations/capability-readiness";
import type { IntegrationCapability } from "@/features/integrations/schema";
import type {
  CapabilitySelections,
  RoutableConnection,
} from "@/features/integrations/routing";
import { getFirebaseClient } from "@/lib/firebase/client";

type StatusPayload = {
  connections: RoutableConnection[];
  selections: CapabilitySelections;
};

/**
 * One request per page, shared by every caller.
 *
 * Integration status was fetched in exactly one place — the settings
 * screen — so every other surface had no way to know which provider signs a
 * contract or raises an invoice. Now that several surfaces ask, they must
 * not each cost a round trip: the promise is cached for the life of the
 * page, which is the same lifetime the answer is good for.
 */
let inFlight: Promise<StatusPayload> | null = null;

function loadStatus(): Promise<StatusPayload> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) throw new Error("NOT_SIGNED_IN");
    const preferred = window.localStorage.getItem("studiohub.activeTenantId");
    const query = preferred
      ? `?tenantId=${encodeURIComponent(preferred)}`
      : "";
    const response = await fetch(`/api/integrations/status${query}`, {
      headers: { authorization: `Bearer ${await user.getIdToken()}` },
      cache: "no-store",
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error ?? "UNAVAILABLE"));
    return {
      connections: Array.isArray(payload.connections)
        ? (payload.connections as RoutableConnection[])
        : [],
      selections:
        typeof payload.selections === "object" && payload.selections !== null
          ? (payload.selections as CapabilitySelections)
          : {},
    };
  })();
  // A failure must not poison the cache for the rest of the session.
  inFlight.catch(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Testing seam and workspace-switch reset. */
export function resetCapabilityCache(): void {
  inFlight = null;
}

/**
 * Who handles this capability, and can they right now.
 *
 * Returns null while loading and on failure. Callers render nothing in
 * that case: a page about to send a proposal should not grow a red box
 * because a status endpoint timed out.
 */
export function useCapability(
  capability: IntegrationCapability,
): CapabilityReadiness | null {
  const [readiness, setReadiness] = useState<CapabilityReadiness | null>(null);

  useEffect(() => {
    let live = true;
    loadStatus()
      .then((status) => {
        if (!live) return;
        setReadiness(
          capabilityReadiness({
            capability,
            connections: status.connections,
            selections: status.selections,
          }),
        );
      })
      .catch(() => {
        if (live) setReadiness(null);
      });
    return () => {
      live = false;
    };
  }, [capability]);

  return readiness;
}
