export const STRIPE_TRIAL_PERIOD_DAYS = 14;

export const buildStripeCheckoutParams = ({
  appUrl,
  customerId,
  priceId,
  tenantId,
}: {
  appUrl: string;
  customerId?: string;
  priceId: string;
  tenantId: string;
}) => {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${appUrl}/studio/subscription?checkout=success`);
  params.set("cancel_url", `${appUrl}/studio/subscription?checkout=cancelled`);
  params.set(
    "subscription_data[trial_period_days]",
    String(STRIPE_TRIAL_PERIOD_DAYS),
  );
  params.set("subscription_data[metadata][tenantId]", tenantId);
  params.set("metadata[tenantId]", tenantId);
  if (customerId) params.set("customer", customerId);
  return params;
};
