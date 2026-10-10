/**
 * What is left to pay on a job, as the screens show it.
 *
 * The accepted proposal's total less every payment on a bill still standing —
 * the same arithmetic functions/src/booking/final-invoice.ts bills by. Display
 * only: sendFinalBalance works the amount out again on the server, so this can
 * never set what a couple is charged.
 *
 * A job booked on an approved retainer exception has no retainer invoice, and
 * counts as nothing paid here — which is also what the server bills by since
 * the money audit of 2026-09-30. Before that the server refused with "record
 * the retainer first" while this offered Send, pushing studios to record
 * money they never received.
 */

type Row = Record<string, unknown> & { id: string };

const NOT_STANDING = ["superseded", "failed", "voided", "void", "cancelled"];

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function outstandingFinalBalance(input: {
  projectId: string;
  proposals: readonly Row[] | null | undefined;
  invoices: readonly Row[] | null | undefined;
  /**
   * QuickBooks is the sales-tax authority for this bill (its calculation says
   * `taxAuthority: "quickbooks"`): the balance is pre-tax, so the tax inside
   * the agreed total is left out — QuickBooks adds its own. The same
   * arithmetic as functions/src/booking/final-tax-authority.ts.
   */
  excludeAgreedTax?: boolean;
  /**
   * A job the studio bills itself, at its own sales tax rate (basis points;
   * features/billing/job-billing-from-records.ts studioTaxRateFor): the
   * balance is the agreed price before tax, plus the studio's tax on it —
   * what its final invoice will carry (functions/src/booking/final-invoice.ts).
   */
  studioTaxBasisPoints?: number | null;
  /**
   * The studio deleted invoice records on this job (own invoicing): what was
   * paid is no longer known, so no balance is worked out and none offered.
   */
  recordsDeleted?: boolean;
}): {
  cents: number | null;
  dueDate: string | null;
  finalStanding: boolean;
  lastFailure: string | null;
  /**
   * A final bill held for the studio to check (`review_required`): standing,
   * so nothing new is offered, and never sent — so it needs saying. It was
   * counted only as "a final bill is out", and Today went quiet about a bill
   * nobody had sent (money audit, wave 1).
   */
  heldForReviewId: string | null;
} {
  const accepted = (input.proposals ?? [])
    .filter((proposal) => proposal.projectId === input.projectId && proposal.status === "accepted")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const pricing = (accepted?.pricingSnapshot ?? null) as Record<string, unknown> | null;
  const agreedTax = Number(pricing?.taxCents);
  const preTax = Number(pricing?.totalCents) - (Number.isSafeInteger(agreedTax) && agreedTax > 0 ? agreedTax : 0);
  const total =
    input.studioTaxBasisPoints !== undefined
      ? preTax + (input.studioTaxBasisPoints ? Math.round((Math.max(0, preTax) * input.studioTaxBasisPoints) / 10000) : 0)
      : Number(pricing?.totalCents) -
        (input.excludeAgreedTax === true && Number.isSafeInteger(agreedTax) && agreedTax > 0 ? agreedTax : 0);
  const standing = (input.invoices ?? []).filter(
    (invoice) => invoice.projectId === input.projectId && !NOT_STANDING.includes(text(invoice.status)),
  );
  const paid = standing.reduce((sum, invoice) => {
    const amount = Number(invoice.amountCents ?? 0);
    const balance = Number(invoice.balanceCents ?? amount);
    return sum + Math.max(0, amount - balance);
  }, 0);
  const schedule = Array.isArray(accepted?.paymentSchedule)
    ? (accepted!.paymentSchedule as Array<Record<string, unknown>>)
    : [];
  return {
    cents: input.recordsDeleted !== true && Number.isFinite(total) && total > paid ? total - paid : null,
    dueDate: text(schedule[1]?.dueDate) || null,
    // A final bill out with the couple (or paid): nothing new to send.
    finalStanding: standing.some((invoice) => invoice.kind === "final"),
    lastFailure: finalBillFailure(
      (input.invoices ?? []).filter((invoice) => invoice.projectId === input.projectId),
    ),
    heldForReviewId:
      standing.find((invoice) => invoice.kind === "final" && invoice.status === "review_required")?.id ?? null,
  };
}

/**
 * Why the last final bill didn't reach the provider, in words to act on — or
 * null when it did. Walked on production: FlawlessIQ's "Send the final bill"
 * failed because its QuickBooks subscription had ended, and the card came
 * straight back saying "Nothing has billed it yet".
 */
export function finalBillFailure(invoices: readonly Record<string, unknown>[]): string | null {
  const failed = invoices
    .filter((invoice) => invoice.kind === "final" && invoice.status === "failed")
    .sort((left, right) => text(right.updatedAt).localeCompare(text(left.updatedAt)))[0];
  if (!failed) return null;
  const provider = failed.provider === "stripe" ? "Stripe" : "QuickBooks";
  const error = (failed.providerError ?? {}) as Record<string, unknown>;
  const message = text(error.message);
  if (/subscription period has ended|trial or subscription|billing problem/i.test(message))
    return `${provider} won't accept new invoices: its subscription has ended or has a billing problem. Sort that out in ${provider}, then send it again.`;
  if (/:40[13]:/.test(message) || /invalid_grant|unauthori[sz]ed/i.test(message))
    return `${provider} rejected the connection. Reconnect it in Integrations, then send it again.`;
  if (/CUSTOMER_(CONTACT|DETAILS)_MISSING/.test(message))
    return `The couple has no email on file, so ${provider} can't be told who to bill. Add it to the job, then send it again.`;
  return `${provider} couldn't create it. Check the connection in Integrations, then send it again.`;
}

/**
 * The final bill that stands, if any — never a superseded or failed one while
 * a live one exists. After a booking change a job carries both, and reading
 * whichever came first told the studio to send a bill already out.
 */
export function currentFinalInvoice<T extends Record<string, unknown>>(invoices: readonly T[]): T | undefined {
  const finals = invoices.filter((invoice) => invoice.kind === "final");
  return finals.find((invoice) => !NOT_STANDING.includes(text(invoice.status))) ?? finals[0];
}
