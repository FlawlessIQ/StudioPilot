import { z } from "zod";
import { adminAppCheck, adminAuth, adminFirestore } from "@/server/firebase/admin";
import { placesProvider } from "@/server/integrations/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Address lookup for signed-in studio surfaces.
 *
 * A proxy rather than a browser key: `GOOGLE_PLACES_API_KEY` stays on the
 * server, and every call is attached to a verified identity with an active
 * membership. A referrer-restricted browser key would be less code and a
 * spendable secret sitting in the page source.
 *
 * The public inquiry form cannot use this — it has no identity — and goes
 * through `publicPlaceSuggest` in functions/, which gates on the studio's
 * public slug and rate-limits by request fingerprint instead.
 */
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suggest"),
    query: z.string().min(1).max(200),
    country: z.string().length(2).nullable().optional(),
    sessionToken: z.string().max(120).nullable().optional(),
  }),
  z.object({
    action: z.literal("resolve"),
    placeId: z.string().min(1).max(400),
    sessionToken: z.string().max(120).nullable().optional(),
  }),
]);

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
}

async function verifyRequest(request: Request) {
  const token = bearerToken(request);
  if (!token) throw new Error("AUTHENTICATION_REQUIRED");
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== "true") {
    const appCheckToken = request.headers.get("x-firebase-appcheck");
    if (!appCheckToken) throw new Error("APP_CHECK_REQUIRED");
    await adminAppCheck.verifyToken(appCheckToken);
  }
  return adminAuth.verifyIdToken(token, true);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const [identity, input] = await Promise.all([
      verifyRequest(request),
      request.json().then((body) => requestSchema.parse(body)),
    ]);

    // Any active membership is enough. This reads no tenant data and
    // creates nothing; the check is here so the key cannot be spent by
    // someone who merely holds a Firebase account.
    const memberships = await adminFirestore
      .collection("memberships")
      .where("userId", "==", identity.uid)
      .where("status", "==", "active")
      .limit(1)
      .get();
    if (memberships.empty) {
      return Response.json({ error: "WORKSPACE_ACCESS_DENIED" }, { status: 403 });
    }

    const provider = placesProvider();
    if (input.action === "suggest") {
      const suggestions = await provider.suggest({
        query: input.query,
        country: input.country ?? null,
        sessionToken: input.sessionToken ?? null,
      });
      return Response.json({ live: provider.live, suggestions });
    }
    const place = await provider.resolve({
      placeId: input.placeId,
      sessionToken: input.sessionToken ?? null,
    });
    return Response.json({ live: provider.live, place });
  } catch (caught: unknown) {
    const code = caught instanceof Error ? caught.message : "PLACES_UNAVAILABLE";
    const status = code === "AUTHENTICATION_REQUIRED" ? 401 : 503;
    // The field degrades to plain typing on any failure, so a provider
    // outage costs autocomplete and never the ability to enter an address.
    return Response.json({ error: code }, { status });
  }
}
