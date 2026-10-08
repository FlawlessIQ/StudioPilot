/**
 * The Console's calls to Stripe (docs/console.md, "Billing").
 *
 * Raw fetch with form bodies, like functions/src/saas/stripe.ts — there is no
 * Stripe SDK in this package. Two things differ from the checkout code:
 *
 * - The API version is pinned per request. Coupon, promotion-code and
 *   subscription-discount parameters have moved between Stripe versions, and
 *   the account default is shared with AdHelm and ScoreOps, so it can change
 *   underneath us. Pinning makes these calls mean the same thing tomorrow.
 * - The account is shared, so everything the Console creates carries
 *   `metadata[app]=studiocue` and is limited to StudioCue's own products, and
 *   the Console only ever lists or touches objects carrying that metadata.
 *
 * BILLING_MOCK_MODE=true (the emulator) never calls Stripe: callers check
 * `stripeMock()` and write the record as Stripe would have.
 */
export const STRIPE_ADMIN_API_VERSION = "2024-06-20";
export const STUDIOCUE_METADATA = { app: "studiocue" } as const;

export function stripeMock(): boolean {
  return process.env.BILLING_MOCK_MODE === "true";
}

type Params = Record<string, string | number | boolean | null | undefined | Array<string>>;

function encode(params: Params): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item, index) => body.append(`${key}[${index}]`, item));
    else body.append(key, String(value));
  }
  return body;
}

export async function stripeRequest<T = Record<string, unknown>>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Params = {},
  /** A POST Stripe must apply at most once, however often it is retried. */
  idempotencyKey?: string,
): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_NOT_CONFIGURED");
  const query = method === "GET" ? `?${encode(params).toString()}` : "";
  const response = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      "stripe-version": STRIPE_ADMIN_API_VERSION,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(method === "POST" && idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: method === "POST" ? encode(params) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!response.ok) {
    const detail = (payload.error?.message ?? "request failed").replace(/[:\n]/g, " ").slice(0, 200);
    throw new Error(`STRIPE_REQUEST_FAILED:${response.status}:${detail}`);
  }
  return payload;
}

/** StudioCue's Stripe product ids, read from the configured prices. */
export async function studiocueProductIds(): Promise<string[]> {
  const priceIds = [
    process.env.STRIPE_PRICE_STUDIO_MONTHLY,
    process.env.STRIPE_PRICE_STUDIO_YEARLY,
    process.env.STRIPE_PRICE_MULTI_BRAND_MONTHLY,
    process.env.STRIPE_PRICE_MULTI_BRAND_YEARLY,
    process.env.STRIPE_PRICE_VENDOR_MONTHLY,
    process.env.STRIPE_PRICE_VENDOR_YEARLY,
  ].filter((value): value is string => Boolean(value));
  const products = await Promise.all(
    priceIds.map((id) => stripeRequest<{ product?: string }>("GET", `prices/${encodeURIComponent(id)}`).then((price) => price.product ?? null)),
  );
  return [...new Set(products.filter((value): value is string => Boolean(value)))];
}

/** Product ids for the plans a code applies to. */
export async function productIdsForPlans(plans: ReadonlyArray<"studio" | "multi_brand">): Promise<string[]> {
  const prices = plans.flatMap((plan) => {
    const key = plan.toUpperCase();
    return [process.env[`STRIPE_PRICE_${key}_MONTHLY`], process.env[`STRIPE_PRICE_${key}_YEARLY`]];
  });
  const ids = prices.filter((value): value is string => Boolean(value));
  if (!ids.length) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
  const products = await Promise.all(
    ids.map((id) => stripeRequest<{ product?: string }>("GET", `prices/${encodeURIComponent(id)}`).then((price) => price.product ?? null)),
  );
  return [...new Set(products.filter((value): value is string => Boolean(value)))];
}

export const unix = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
export const fromUnix = (value: unknown): string | null =>
  typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;

/** Stripe refuses a trial end more than two years out. */
export const MAX_TRIAL_DAYS = 730;
