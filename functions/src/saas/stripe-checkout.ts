// Onboarding creates the tenant in `incomplete` and the FIRST checkout starts a
// fresh 14-day trial anchored at checkout time; a later re-checkout HONOURS the
// existing end rather than restarting one — see below.
export const STRIPE_TRIAL_PERIOD_DAYS = 14;

export const buildStripeCheckoutParams = ({
  appUrl,
  customerId,
  customerEmail,
  priceId,
  tenantId,
  trialEndIso,
  firstCheckout,
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
}) => {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  // Card-required trial: collect a payment method up front even though the
  // first 14 days don't charge, so the trial converts (or fails to past_due)
  // on its own instead of becoming a free-forever account. Without this Stripe
  // defaults to "if_required" for trials and lets the trial start with no card.
  params.set("payment_method_collection", "always");
  // A monthly B2B SaaS subscription takes a card, not Cash App Pay / Klarna
  // (audit deferred item P11-methods). Pin the method rather than inheriting the
  // account's globally-enabled set, which is shared with other FlawlessIQ products.
  params.set("payment_method_types[0]", "card");
  params.set("success_url", `${appUrl}/studio/subscription?checkout=success`);
  params.set("cancel_url", `${appUrl}/studio/subscription?checkout=cancelled`);
  if (firstCheckout) {
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
