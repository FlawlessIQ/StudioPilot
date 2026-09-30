/**
 * What a Stripe Connect invoice event says about a failed charge.
 *
 * `invoice.payment_failed` carries no paid amount and a full balance, so it
 * fell through to `sent` — a declined card read exactly like a bill still
 * waiting to be paid, and nobody was told (wave 3, 2026-09-30). The status
 * rule stays as it was (invoice-standing.ts decides it, and a failed charge
 * is not a new status: the bill is still owed). What changes is the record
 * beside it: `paymentFailedAt` and the attempt detail, which Today turns
 * into "payment failed" (features/today/inbox.ts). A later payment, a void,
 * or the studio settling it clears the flag. Pure.
 */

export type PaymentFailureFields = {
  paymentFailedAt?: string | null;
  paymentFailure?: {
    providerEventId: string;
    attemptCount: number | null;
    nextAttemptAt: string | null;
  } | null;
};

const CLEARING_STATUSES = new Set(["paid", "voided", "void", "refunded", "superseded", "cancelled"]);

export function stripePaymentFailureFields(input: {
  eventType: string;
  eventId: string;
  /** The status the invoice keeps after this event (providerReportedInvoice). */
  decidedStatus: string;
  object: Record<string, unknown>;
  now: string;
}): PaymentFailureFields {
  if (CLEARING_STATUSES.has(input.decidedStatus)) {
    return { paymentFailedAt: null, paymentFailure: null };
  }
  if (input.eventType !== "invoice.payment_failed") return {};
  const attempts = Number(input.object.attempt_count);
  const next = Number(input.object.next_payment_attempt);
  return {
    paymentFailedAt: input.now,
    paymentFailure: {
      providerEventId: input.eventId,
      attemptCount: Number.isFinite(attempts) && attempts > 0 ? attempts : null,
      // Stripe retries on its own schedule (Smart Retries); when it will is
      // worth knowing before anyone chases the couple.
      nextAttemptAt: Number.isFinite(next) && next > 0 ? new Date(next * 1000).toISOString() : null,
    },
  };
}
