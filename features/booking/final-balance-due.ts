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
}): { cents: number | null; dueDate: string | null; finalStanding: boolean; lastFailure: string | null } {
  const accepted = (input.proposals ?? [])
    .filter((proposal) => proposal.projectId === input.projectId && proposal.status === "accepted")
    .sort((left, right) => Number(right.version ?? 0) - Number(left.version ?? 0))[0];
  const pricing = (accepted?.pricingSnapshot ?? null) as Record<string, unknown> | null;
  const total = Number(pricing?.totalCents);
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
    cents: Number.isFinite(total) && total > paid ? total - paid : null,
    dueDate: text(schedule[1]?.dueDate) || null,
    // A final bill out with the couple (or paid): nothing new to send.
    finalStanding: standing.some((invoice) => invoice.kind === "final"),
    lastFailure: finalBillFailure(
      (input.invoices ?? []).filter((invoice) => invoice.projectId === input.projectId),
    ),
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
