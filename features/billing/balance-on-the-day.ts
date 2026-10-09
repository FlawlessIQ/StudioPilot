/**
 * A balance collected on the morning (simpler vendor journeys, Phase 4).
 *
 * A makeup artist or hair stylist is paid the rest on the day of the event
 * (features/trades/trades.ts `balanceOnTheDay`; job-kinds.ts `journeyFor`
 * keeps it to a job that books with a deposit). Their client is not sent a
 * final invoice weeks ahead (functions/src/operations/invoice-scheduler.ts),
 * so a screen that only read invoices told them "All paid" — and told the
 * studio nothing was owed. This is what is owed, read from what was agreed.
 *
 * Null when the job pays some other way, when nothing is owed, or when a
 * final invoice already stands: a bill the studio sent by hand, or one raised
 * for autopay, is shown as the invoice it is.
 *
 * The amount is the one `recordFinalPayment` records (agreed-final-balance.ts):
 * the accepted proposal's final line, or its total less the retainer paid.
 *
 * Pure.
 */
import { balanceFromTotals, finalBalanceFromSchedule } from "@/features/booking/agreed-final-balance";
import { isStandingInvoice } from "@/features/booking/invoice-standing";
import { journeyFor, projectProfile } from "@/features/job-kinds/job-kinds";
import { tradeProfile } from "@/features/trades/trades";

type Row = Record<string, unknown>;

export type MorningBalance = {
  amountCents: number;
  currency: string;
  /** The day it is collected, YYYY-MM-DD, when the job has one. */
  eventDate: string | null;
  /** Today is the morning. */
  today: boolean;
  /** The morning has passed and nothing records it paid. */
  past: boolean;
};

const cents = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

/** Whether this job's balance is collected on the morning rather than invoiced ahead. */
export function balanceCollectedOnTheDay(project: unknown, trade: unknown): boolean {
  return journeyFor(projectProfile(project), tradeProfile(trade)).balanceOnTheDay;
}

export function morningBalance(input: {
  project: unknown;
  /** The studio's trade (tenants/{id}.trade, or the workspace's `tenantTrade`). */
  trade: unknown;
  proposals: ReadonlyArray<Row>;
  invoices: ReadonlyArray<Row>;
  /** YYYY-MM-DD, local to the viewer. */
  today: string;
}): MorningBalance | null {
  if (!balanceCollectedOnTheDay(input.project, input.trade)) return null;
  const standing = input.invoices.filter((invoice) => isStandingInvoice(invoice.status));
  if (standing.some((invoice) => invoice.kind === "final")) return null;
  const accepted = input.proposals
    .filter((proposal) => proposal.status === "accepted")
    .sort((left, right) => cents(right.version) - cents(left.version))[0];
  if (!accepted) return null;
  const pricing = (accepted.pricingSnapshot && typeof accepted.pricingSnapshot === "object"
    ? accepted.pricingSnapshot
    : {}) as Row;
  // What the retainer actually collected, not what it was billed for.
  const retainerPaidCents = standing
    .filter((invoice) => invoice.kind === "retainer")
    .reduce((sum, invoice) => sum + Math.max(0, cents(invoice.amountCents) - cents(invoice.balanceCents)), 0);
  const amountCents = finalBalanceFromSchedule(
    accepted.paymentSchedule,
    balanceFromTotals(cents(pricing.totalCents), retainerPaidCents),
  );
  if (!(amountCents > 0)) return null;
  const day = String(((input.project ?? {}) as { eventDate?: unknown }).eventDate ?? "").slice(0, 10);
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  return {
    amountCents,
    currency: typeof pricing.currency === "string" && pricing.currency ? pricing.currency : "USD",
    eventDate,
    today: eventDate === input.today,
    past: Boolean(eventDate && eventDate < input.today),
  };
}
