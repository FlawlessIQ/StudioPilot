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

/**
 * Which studio a slug belongs to, remembered for a few minutes.
 *
 * Every keystroke's suggestion request used to look the studio up again —
 * by alias, then (after that missed) by slug — then take a Firestore
 * transaction for the rate limit, and only then ask Google. Measured on
 * production 2026-09-28 at 540–750 ms a request. A studio going inactive is
 * honoured within the cache window; a miss is never cached.
 */
const TENANT_CACHE_MS = 5 * 60 * 1000;
const tenantBySlug = new Map<string, { id: string; expiresAt: number }>();

async function activeTenantId(slug: string): Promise<string | null> {
  const cached = tenantBySlug.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.id;
  // Old addresses still resolve, so a slug change does not break the venue
  // lookup on a form a client already has open. See app/inquiry/page.tsx.
  const [byAlias, bySlug] = await Promise.all([
    adminFirestore
      .collection("tenants")
      .where("slugAliases", "array-contains", slug)
      .where("status", "in", ["trial", "active"])
      .limit(1)
      .get(),
    adminFirestore
      .collection("tenants")
      .where("publicSlug", "==", slug)
      .where("status", "in", ["trial", "active"])
      .limit(1)
      .get(),
  ]);
  const id = (byAlias.docs[0] ?? bySlug.docs[0])?.id ?? null;
  if (id) tenantBySlug.set(slug, { id, expiresAt: Date.now() + TENANT_CACHE_MS });
  return id;
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();
  try {
    const input = requestSchema.parse(await request.json());

    // The limit is keyed on the slug the form names, not the tenant id, so it
    // no longer has to wait for the studio lookup: the two run together.
    const [tenantId, allowed] = await Promise.all([
      activeTenantId(input.tenantSlug),
      withinRateLimit(fingerprint(request, `places:${input.tenantSlug}`)),
    ]);
    if (!tenantId) {
      return Response.json({ error: "STUDIO_UNAVAILABLE" }, { status: 404 });
    }
    if (!allowed) {
      return Response.json({ error: "RATE_LIMITED" }, { status: 429 });
    }
    const checked = Date.now();

    const provider = placesProvider();
    if (input.action === "suggest") {
      const suggestions = await provider.suggest({
        query: input.query,
        country: input.country ?? null,
        sessionToken: input.sessionToken ?? null,
      });
      return Response.json(
        { live: provider.live, suggestions },
        { headers: timing(started, checked) },
      );
    }
    const place = await provider.resolve({
      placeId: input.placeId,
      sessionToken: input.sessionToken ?? null,
    });
    return Response.json(
      { live: provider.live, place },
      { headers: timing(started, checked) },
    );
  } catch (caught: unknown) {
    // The field falls back to plain typing, so a couple can always finish
    // their inquiry whatever happens here.
    const code = caught instanceof Error ? caught.message : "PLACES_UNAVAILABLE";
    return Response.json({ error: code }, { status: 503 });
  }
}

/** Where a lookup's time went, readable in the browser's network panel. */
function timing(started: number, checked: number): Record<string, string> {
  const now = Date.now();
  return {
    "server-timing": `checks;dur=${checked - started}, places;dur=${now - checked}`,
  };
}
