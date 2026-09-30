/**
 * What is left to pay on a job, as the screens show it.
 *
 * The accepted proposal's total less every payment on a bill still standing —
 * the same arithmetic functions/src/booking/final-invoice.ts bills by. Display
 * only: sendFinalBalance works the amount out again on the server, so this can
 * never set what a couple is charged.
 */

type Row = Record<string, unknown> & { id: string };

const NOT_STANDING = ["superseded", "failed", "voided", "void", "cancelled"];

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function outstandingFinalBalance(input: {
  projectId: string;
  proposals: readonly Row[] | null | undefined;
  invoices: readonly Row[] | null | undefined;
}): { cents: number | null; dueDate: string | null; finalStanding: boolean } {
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
  };
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
