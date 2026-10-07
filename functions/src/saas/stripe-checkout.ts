// Onboarding creates the tenant in `incomplete` and the FIRST checkout starts a
// fresh 14-day trial anchored at checkout time; a later re-checkout HONOURS the
// existing end rather than restarting one — see below.
export const STRIPE_TRIAL_PERIOD_DAYS = 14;

/** A Stripe unix-seconds timestamp to an ISO string, or null if absent. */
export const stripeSecondsToIso = (value: unknown): string | null =>
  typeof value === "number" ? new Date(value * 1000).toISOString() : null;

/**
 * The current period start/end for a subscription, from a webhook object.
 *
 * Stripe moved `current_period_start/end` off the subscription object and onto
 * its items in recent API versions, so reading only the top-level fields left
 * the period stuck at whatever was written before (for a new studio, the trial
 * end anchored at workspace creation — ~38 min before the real checkout-anchored
 * trial, so "Trial ends …" showed the wrong instant). Resolve from the object,
 * then the first item, then `trial_start/end` for a trial — whose period end IS
 * the trial end. Returns null for a field when none is present, so the caller
 * can fall back to the stored value.
 */
export const resolveSubscriptionPeriod = (
  object: {
    current_period_start?: unknown;
    current_period_end?: unknown;
    trial_start?: unknown;
    trial_end?: unknown;
  },
  firstItem?: { current_period_start?: unknown; current_period_end?: unknown },
): { start: string | null; end: string | null } => ({
  start:
    stripeSecondsToIso(object.current_period_start) ??
    stripeSecondsToIso(firstItem?.current_period_start) ??
    stripeSecondsToIso(object.trial_start),
  end:
    stripeSecondsToIso(object.current_period_end) ??
    stripeSecondsToIso(firstItem?.current_period_end) ??
    stripeSecondsToIso(object.trial_end),
});

/**
 * A promotion code as carried in from a signup link (`/auth/register?code=BETA`).
 * Stripe codes are case-insensitive letters, digits, hyphens and underscores;
 * anything else is dropped rather than sent.
 */
export const normalizePromotionCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9_-]{2,64}$/.test(code) ? code : null;
};

/** What Checkout needs to know about a code resolved before the session. */
export type ResolvedPromotion = {
  /** Stripe's `promo_…` id — what `discounts[0][promotion_code]` takes. */
  promotionCodeId: string;
  /**
   * 100% off with `duration: forever`: the studio never owes anything, so
   * Checkout neither collects a card nor starts a trial (see below).
   */
  freeForever: boolean;
  /**
   * A partner referral code (Console → Partners): its discount is for the
   * annual plan only, so Checkout puts the studio on the yearly price whatever
   * cadence was picked. A coupon can be limited to a product, not to a price,
   * so this is where "annual only" is kept.
   */
  annualOnly: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * The coupon a promotion code points at — an embedded object or a bare id.
 * Older Stripe API versions embed it as `coupon`; 2025-09-30 and later moved it
 * to `promotion: { type: "coupon", coupon: "…" }`. Read either.
 */
export const promotionCouponReference = (
  promotionCode: Record<string, unknown>,
): Record<string, unknown> | string | null => {
  for (const candidate of [
    promotionCode.coupon,
    asRecord(promotionCode.promotion)?.coupon,
  ]) {
    const object = asRecord(candidate);
    if (object) return object;
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
};

/**
 * Whether a promotion code (and its coupon) can be applied now, and if so how.
 *
 * Only a code Stripe still calls `active`, whose coupon is still `valid`, that
 * hasn't passed its `expires_at` or used up its `max_redemptions`, resolves.
 * Anything else returns null and Checkout falls back to its own code field
 * (`allow_promotion_codes`), so a stale or revoked link never strands the
 * studio on an error — they can type a working code or start a normal trial.
 */
export const resolvePromotion = (
  promotionCode: unknown,
  coupon: unknown,
  nowMs: number = Date.now(),
): ResolvedPromotion | null => {
  const code = asRecord(promotionCode);
  const couponRecord = asRecord(coupon);
  if (!code || !couponRecord) return null;
  if (typeof code.id !== "string" || !code.id.startsWith("promo_")) return null;
  if (code.active !== true || couponRecord.valid !== true) return null;
  if (typeof code.expires_at === "number" && code.expires_at * 1000 <= nowMs)
    return null;
  if (
    typeof code.max_redemptions === "number" &&
    typeof code.times_redeemed === "number" &&
    code.times_redeemed >= code.max_redemptions
  )
    return null;
  const codeMetadata = asRecord(code.metadata) ?? {};
  const couponMetadata = asRecord(couponRecord.metadata) ?? {};
  return {
    promotionCodeId: code.id,
    freeForever:
      couponRecord.percent_off === 100 && couponRecord.duration === "forever",
    annualOnly: codeMetadata.kind === "partner" || couponMetadata.kind === "partner",
  };
};

export const buildStripeCheckoutParams = ({
  appUrl,
  customerId,
  customerEmail,
  priceId,
  tenantId,
  trialEndIso,
  firstCheckout,
  promotion,
}: {
  appUrl: string;
  customerId?: string;
  /** The owner's email, used only when there is no Stripe customer yet. */
  customerEmail?: string | null;
  priceId: string;
  tenantId: string;
  /** The tenant's existing trial end (ISO), from the subscription record. */
  trialEndIso?: string | null;
  /**
   * True on the very first checkout (subscription still `incomplete` — the
   * trial has never actually started). Grant a fresh `trial_period_days`
   * anchored at checkout so the buyer gets a full 14 whole days and Stripe's
   * Checkout page reads "14 days free". Onboarding writes `trialEndAt` at
   * workspace-creation time, seconds-to-minutes before checkout, so honouring
   * that timestamp here would hand Stripe <14 days and it would floor the
   * banner to "13 days free". Re-checkouts (not first) still honour the stored
   * end so a late card-adder can't mint themselves a new trial.
   */
  firstCheckout?: boolean;
  /**
   * A code resolved server-side from the signup link, applied as a discount.
   * Without one, Checkout shows its own "Add promotion code" field instead.
   * Stripe refuses `allow_promotion_codes` together with `discounts`, so it is
   * always exactly one of the two.
   */
  promotion?: ResolvedPromotion | null;
}) => {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  // Card-required trial: collect a payment method up front even though the
  // first 14 days don't charge, so the trial converts (or fails to past_due)
  // on its own instead of becoming a free-forever account. Without this Stripe
  // defaults to "if_required" for trials and lets the trial start with no card.
  //
  // The one exception is a resolved code that is 100% off forever (a comped
  // beta studio): nothing will ever be charged, so a card is friction with no
  // purpose. "if_required" makes Checkout skip the card when the amount due is
  // $0, which it always is under that code. A code typed into Checkout's own
  // field can't be known here, so that path keeps "always": the card is
  // collected and simply never charged.
  const freeForever = promotion?.freeForever === true;
  params.set(
    "payment_method_collection",
    freeForever ? "if_required" : "always",
  );
  // A monthly B2B SaaS subscription takes a card, not Cash App Pay / Klarna
  // (audit deferred item P11-methods). Pin the method rather than inheriting the
  // account's globally-enabled set, which is shared with other FlawlessIQ products.
  params.set("payment_method_types[0]", "card");
  // Stripe fills in the session id, so the return can confirm the trial if the
  // webhook is late (billingCommand confirmCheckout).
  params.set(
    "success_url",
    `${appUrl}/studio/subscription?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
  );
  params.set("cancel_url", `${appUrl}/studio/subscription?checkout=cancelled`);
  if (promotion) {
    params.set("discounts[0][promotion_code]", promotion.promotionCodeId);
  } else {
    params.set("allow_promotion_codes", "true");
  }
  if (freeForever) {
    // No trial for a free-forever studio: it would read "Free trial · Trial
    // ends …" for 14 days and then flip to `active` on a $0 invoice anyway.
    // Starting `active` with $0 invoices passes the gate, which is status-only
    // (subscriptionGrantsAccess: trialing | active).
  } else if (firstCheckout) {
    // First checkout: anchor a full 14-day trial at checkout time. Gives the
    // buyer 14 whole days (not 14-minus-the-onboarding-gap) and makes Stripe's
    // Checkout page read "14 days free" rather than flooring to 13.
    params.set(
      "subscription_data[trial_period_days]",
      String(STRIPE_TRIAL_PERIOD_DAYS),
    );
  } else {
    // P10: a re-checkout honours the tenant's existing trial end instead of
    // restarting a fresh trial. A future `trial_end` preserves the exact
    // countdown; a past or missing one means the trial has already ended, so
    // Checkout collects payment now and re-grants nothing — a late card-adder
    // can't mint themselves a brand-new 14 days.
    const trialEndMs = trialEndIso ? Date.parse(trialEndIso) : Number.NaN;
    if (Number.isFinite(trialEndMs) && trialEndMs > Date.now() + 60_000) {
      params.set(
        "subscription_data[trial_end]",
        String(Math.floor(trialEndMs / 1000)),
      );
    }
  }
  params.set("subscription_data[metadata][tenantId]", tenantId);
  params.set("metadata[tenantId]", tenantId);
  if (customerId) {
    params.set("customer", customerId);
  } else if (customerEmail) {
    // P11: prefill the email so the owner isn't retyping an address StudioCue
    // already verified. Stripe rejects customer_email together with customer,
    // so only when there is no customer yet.
    params.set("customer_email", customerEmail);
  }
  return params;
};
