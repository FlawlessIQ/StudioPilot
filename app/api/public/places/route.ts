import { createHash } from "node:crypto";
import { z } from "zod";
import { adminFirestore } from "@/server/firebase/admin";
import { placesProvider } from "@/server/integrations/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Address lookup for the public inquiry form.
 *
 * The venue a couple types into the inquiry form is the first thing a
 * studio ever learns about the job, and it was free text. Autocompleting it
 * needs an endpoint with no signed-in identity behind it, which makes this
 * the one place the Places key could be spent by a stranger. Three things
 * stop that, all borrowed from the inquiry submission itself:
 *
 * - the request must name a studio whose public slug exists and whose
 *   account is live, so it cannot be called in the abstract;
 * - it is rate-limited by request fingerprint, in the same
 *   `publicRateLimits` collection, at a ceiling sized for typing rather
 *   than for submitting;
 * - it returns suggestions and one resolved address. Nothing else about
 *   the tenant is readable through it.
 *
 * Deliberately a Next route rather than a Cloud Function. `publicLeadIntake`
 * is a Function because it does real business work — contacts, duplicates,
 * date conflicts. This proxies one read-only provider call, and putting it
 * here avoids adding a function to the relay allowlist and the invoker
 * script for no gain.
 */
const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("suggest"),
    tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
    query: z.string().min(1).max(200),
    country: z.string().length(2).nullable().optional(),
    sessionToken: z.string().max(120).nullable().optional(),
  }),
  z.object({
    action: z.literal("resolve"),
    tenantSlug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/),
    placeId: z.string().min(1).max(400),
    sessionToken: z.string().max(120).nullable().optional(),
  }),
]);

/** One typing session is many requests; one inquiry is one. Sized for typing. */
const HOURLY_LIMIT = 120;
const WINDOW_MS = 60 * 60 * 1000;

function fingerprint(request: Request, scope: string): string {
  // The first hop in x-forwarded-for is the client as the load balancer saw
  // it; the rest are proxies and are attacker-controllable.
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || "unknown";
  const agent = request.headers.get("user-agent") ?? "unknown";
  return createHash("sha256").update(`${scope}|${ip}|${agent}`).digest("hex");
}

async function withinRateLimit(id: string): Promise<boolean> {
  const reference = adminFirestore.doc(`publicRateLimits/${id}`);
  const now = Date.now();
  try {
    await adminFirestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data() as
        | { windowStartedAt: number; count: number }
        | undefined;
      const withinWindow = data && now - data.windowStartedAt < WINDOW_MS;
      const nextCount = withinWindow ? data.count + 1 : 1;
      if (nextCount > HOURLY_LIMIT) throw new Error("RATE_LIMITED");
      transaction.set(reference, {
        windowStartedAt: withinWindow ? data.windowStartedAt : now,
        count: nextCount,
        expiresAt: new Date(now + WINDOW_MS * 2).toISOString(),
      });
    });
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = requestSchema.parse(await request.json());

    // Old addresses still resolve, so a slug change does not break the venue
    // lookup on a form a client already has open. See app/inquiry/page.tsx.
    const byAlias = await adminFirestore
      .collection("tenants")
      .where("slugAliases", "array-contains", input.tenantSlug)
      .where("status", "in", ["trial", "active"])
      .limit(1)
      .get();
    const tenants = byAlias.empty
      ? await adminFirestore
          .collection("tenants")
          .where("publicSlug", "==", input.tenantSlug)
          .where("status", "in", ["trial", "active"])
          .limit(1)
          .get()
      : byAlias;
    const tenant = tenants.docs[0];
    if (!tenant) {
      return Response.json({ error: "STUDIO_UNAVAILABLE" }, { status: 404 });
    }

    const allowed = await withinRateLimit(
      fingerprint(request, `places:${tenant.id}`),
    );
    if (!allowed) {
      return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
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
    // The field falls back to plain typing, so a couple can always finish
    // their inquiry whatever happens here.
    const code = caught instanceof Error ? caught.message : "PLACES_UNAVAILABLE";
    return Response.json({ error: code }, { status: 503 });
  }
}
