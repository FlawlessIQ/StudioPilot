"use client";

import type { CapturedPlace, PlaceSuggestion } from "@/features/places/schema";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

/**
 * Where address lookups go.
 *
 * Two routes, because they have two different things to prove. Signed-in
 * studio surfaces prove an identity with an active membership. The public
 * inquiry form has no identity, so it names the studio whose form it is and
 * is rate-limited by request fingerprint instead.
 *
 * Both hold the API key server-side, and both return `live: false` when no
 * provider is configured — the field says so rather than letting five demo
 * venues pass for a lookup.
 */
export type PlacesResult<T> = { live: boolean; value: T };

export type PlacesSource =
  | { kind: "studio" }
  | { kind: "public"; tenantSlug: string };

/**
 * A token that groups one person's keystrokes plus their final choice into
 * a single billable Places session. Without it every keystroke is charged
 * as its own autocomplete request.
 */
export function newPlacesSession(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function studioHeaders(): Promise<Record<string, string>> {
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("NOT_SIGNED_IN");
  const appCheckToken = await getAppCheckToken();
  return {
    "content-type": "application/json",
    authorization: `Bearer ${await user.getIdToken()}`,
    ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
  };
}

async function post(
  source: PlacesSource,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response =
    source.kind === "public"
      ? await fetch("/api/public/places", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, tenantSlug: source.tenantSlug }),
          signal,
        })
      : await fetch("/api/studio/places", {
          method: "POST",
          headers: await studioHeaders(),
          body: JSON.stringify(body),
          signal,
        });
  if (!response.ok) throw new Error(`PLACES_${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

export async function suggestPlaces(
  input: {
    query: string;
    country?: string | null;
    sessionToken?: string | null;
    source: PlacesSource;
  },
  signal: AbortSignal,
): Promise<PlacesResult<PlaceSuggestion[]>> {
  const payload = await post(
    input.source,
    {
      action: "suggest",
      query: input.query,
      country: input.country ?? null,
      sessionToken: input.sessionToken ?? null,
    },
    signal,
  );
  return {
    live: payload.live === true,
    value: Array.isArray(payload.suggestions)
      ? (payload.suggestions as PlaceSuggestion[])
      : [],
  };
}

export async function resolvePlace(
  input: {
    placeId: string;
    sessionToken?: string | null;
    source: PlacesSource;
  },
  signal: AbortSignal,
): Promise<PlacesResult<CapturedPlace | null>> {
  const payload = await post(
    input.source,
    {
      action: "resolve",
      placeId: input.placeId,
      sessionToken: input.sessionToken ?? null,
    },
    signal,
  );
  return {
    live: payload.live === true,
    value: (payload.place as CapturedPlace | null) ?? null,
  };
}
