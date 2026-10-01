/**
 * The functions copy of the standing-invoice rule.
 *
 * features/booking/invoice-standing.ts is the source of truth; functions/
 * is a separate package with no "@/features" path, so the rule is
 * duplicated here. `tests/booking-gate.test.ts` fails on a drift.
 */
const NOT_STANDING = new Set(["failed", "superseded", "voided"]);

export function isStandingInvoice(status: unknown): boolean {
  return !NOT_STANDING.has(String(status));
}

/**
 * An invoice StudioCue has finished with: no provider work may touch it.
 *
 * Found in the money audit of 2026-09-30. A studio recorded a bank transfer
 * while the QuickBooks create job for the same invoice was still queued (or
 * retrying). The worker checked only `providerState`, so it went on to create
 * the invoice, email the couple a bill they had already paid, and write
 * `sent` and the full balance over the payment. If the job instead ran out of
 * retries, the failure path wrote `failed` over it — and a failed invoice is
 * not standing, so the paid retainer vanished from the books.
 *
 * Paid (by any authority), replaced by a booking change, voided, or closed
 * because the job was called off: each of these is a decision already made,
 * and a queued provider job predates it.
 */
const CLOSED_TO_PROVIDER_WORK = new Set([
  "paid",
  "superseded",
  "voided",
  "void",
  "cancelled",
]);

export function invoiceClosedToProviderWork(status: unknown): boolean {
  return CLOSED_TO_PROVIDER_WORK.has(String(status));
}

/** A payment a person vouched for, rather than one a provider confirmed. */
const STUDIO_VOUCHED = new Set(["manual_attested", "imported"]);

/**
 * What a provider's report may do to an invoice StudioCue already closed.
 *
 * A QuickBooks webhook fires on any change to the invoice — an email resent,
 * a memo edited — and the reconcile re-read its balance and wrote `sent` over
 * a retainer the studio had recorded as paid by transfer. QuickBooks never
 * saw that money, so its balance is not evidence the couple still owes it.
 *
 * The provider wins only when it reports the invoice paid or voided: both are
 * facts about the invoice StudioCue cannot know better. Anything else leaves
 * a studio-vouched payment, or an invoice StudioCue superseded or closed,
 * exactly as it was, and says why.
 */
export function providerReportedInvoice(input: {
  current: {
    status: unknown;
    completionAuthority?: unknown;
    balanceCents?: unknown;
    studioPayments?: unknown;
  };
  reported: { status: string; balanceCents: number };
}): { status: string; balanceCents: number; keptReason: string | null } {
  const { current, reported } = input;
  if (reported.status === "paid" || reported.status === "voided")
    return { ...reported, keptReason: null };
  const status = String(current.status);
  if (status === "paid" && STUDIO_VOUCHED.has(String(current.completionAuthority)))
    return { status: "paid", balanceCents: 0, keptReason: "studio_recorded_payment" };
  // `voided` joins them since StudioCue can void an invoice itself
  // (voidInvoice). When the provider void fails, the invoice is still open
  // there, and its next unrelated webhook must not reopen the bill here.
  if (status === "superseded" || status === "cancelled" || status === "voided")
    return {
      status,
      balanceCents: Number(current.balanceCents ?? 0),
      keptReason: "closed_in_studiocue",
    };
  // Held for the studio to check before it goes (QuickBooks as the sales-tax
  // authority): QuickBooks' own create webhook reads it as "sent", and it was
  // never sent. Only paid or voided, above, moves it.
  if (status === "review_required")
    return { status, balanceCents: Number(current.balanceCents ?? 0), keptReason: "held_for_studio_review" };
  // A payment the studio recorded here that QuickBooks or Stripe has not taken
  // yet (its job is queued, or failed and the studio was asked to record it
  // there). Until the provider has it, the provider's higher balance is the
  // one that is out of date: re-reading it would put the money back on the
  // couple's bill, and autopay would charge it.
  const currentBalance = Number(current.balanceCents ?? 0);
  if (unconfirmedStudioPaymentCents(current.studioPayments) > 0 && reported.balanceCents > currentBalance)
    return { status, balanceCents: currentBalance, keptReason: "studio_payment_not_at_provider" };
  return { ...reported, keptReason: null };
}

/**
 * Paid here, by a payment a person recorded (booking/invoice-payments), and
 * not yet taken by the provider: its push is queued, or failed.
 */
export function unconfirmedStudioPaymentCents(studioPayments: unknown): number {
  if (!Array.isArray(studioPayments)) return 0;
  return studioPayments.reduce<number>((sum, payment) => {
    const entry = (payment ?? {}) as { amountCents?: unknown; provider?: { state?: unknown } | null };
    const state = String(entry.provider?.state ?? "");
    const amount = Number(entry.amountCents);
    return (state === "queued" || state === "failed") && Number.isSafeInteger(amount) && amount > 0
      ? sum + amount
      : sum;
  }, 0);
}
