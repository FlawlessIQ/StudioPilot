// Onboarding grants the 14-day trial and records its end on the subscription.
// Checkout HONOURS that end rather than starting a new one — see below.
export const STRIPE_TRIAL_PERIOD_DAYS = 14;

export const buildStripeCheckoutParams = ({
  appUrl,
  customerId,
  customerEmail,
  priceId,
  tenantId,
  trialEndIso,
}: {
  appUrl: string;
  customerId?: string;
  /** The owner's email, used only when there is no Stripe customer yet. */
  customerEmail?: string | null;
  priceId: string;
  tenantId: string;
  /** The tenant's existing trial end (ISO), from the subscription record. */
  trialEndIso?: string | null;
}) => {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${appUrl}/studio/subscription?checkout=success`);
  params.set("cancel_url", `${appUrl}/studio/subscription?checkout=cancelled`);
  // P10: honour the tenant's existing trial end instead of restarting a fresh
  // 14-day trial at checkout. A future `trial_end` preserves the exact
  // countdown the tenant has been on since onboarding; a past or missing one
  // means the trial has already ended, so Checkout collects payment now and
  // re-grants nothing. (This previously always set `trial_period_days=14`,
  // giving a late card-adder up to 24 free days and handing an expired trial a
  // brand-new 14 days.)
  const trialEndMs = trialEndIso ? Date.parse(trialEndIso) : Number.NaN;
  if (Number.isFinite(trialEndMs) && trialEndMs > Date.now() + 60_000) {
    params.set(
      "subscription_data[trial_end]",
      String(Math.floor(trialEndMs / 1000)),
    );
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
