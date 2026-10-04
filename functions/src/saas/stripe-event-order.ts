/**
 * Whether a Stripe subscription event arrived too late to apply.
 *
 * Stripe does not promise delivery order. Events were deduplicated by id and
 * nothing else, so a `customer.subscription.updated` (status trialing) that
 * was retried after the `deleted` that followed it would write the
 * subscription back to life — a cancelled studio with full access, and a
 * Console showing a trial that no longer exists in Stripe.
 *
 * Two checks, both against what is already stored:
 * - **older_than_applied** — the event was created before the last event we
 *   applied. Equal timestamps apply: `created` is in whole seconds, and two
 *   genuine changes in one second are both real.
 * - **subscription_already_cancelled** — the stored record is a cancelled
 *   copy of this same Stripe subscription, and the event would make it
 *   anything else. Cancellation is final in Stripe; a studio that returns
 *   gets a new subscription id, which this does not block.
 */
export type StaleStripeEvent = "older_than_applied" | "subscription_already_cancelled";

export function staleStripeEvent(input: {
  lastAppliedCreated: unknown;
  eventCreated: number;
  storedStatus: unknown;
  storedSubscriptionId: unknown;
  eventSubscriptionId: unknown;
  eventStatus: unknown;
  deleted: boolean;
}): StaleStripeEvent | null {
  if (
    typeof input.lastAppliedCreated === "number" &&
    input.eventCreated < input.lastAppliedCreated
  ) {
    return "older_than_applied";
  }
  const sameSubscription =
    typeof input.storedSubscriptionId === "string" &&
    input.storedSubscriptionId !== "" &&
    input.storedSubscriptionId === input.eventSubscriptionId;
  const revives =
    !input.deleted &&
    input.eventStatus !== "canceled" &&
    input.eventStatus !== "cancelled" &&
    input.eventStatus !== "incomplete_expired";
  if (sameSubscription && input.storedStatus === "cancelled" && revives) {
    return "subscription_already_cancelled";
  }
  return null;
}
