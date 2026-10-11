/**
 * Money formatting. Amounts are integer cents everywhere in this codebase
 * (see the multi-tenancy invariants in CLAUDE.md) — these helpers are the only
 * place that division by 100 should happen.
 *
 * Twelve components each built their own Intl.NumberFormat before this, which
 * is how "$9,878" and "$9,878.00" ended up on adjacent screens.
 */

const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const exactDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Headline figures — KPI tiles, totals, pipeline value. Rounds to the dollar,
 * because a dashboard reads better as "$9,878" than "$9,878.00".
 */
export function formatCents(cents: number | null | undefined): string {
  return wholeDollars.format(Math.round(Number(cents ?? 0)) / 100);
}

/**
 * Anything a client could reconcile against an invoice — line items, balances,
 * retainers. Always shows cents, because money owed must be exact.
 */
export function formatCentsExact(cents: number | null | undefined): string {
  return exactDollars.format(Math.round(Number(cents ?? 0)) / 100);
}

/**
 * Whole dollars when the amount is whole, the cents when it isn't: "$300",
 * "$112.50". For a figure a client will be asked for, previewed beside a
 * form: 30% of $375 read "$113" there and $112.50 on the quote (Jess Styles
 * Bridal, 2026-10-10).
 */
export function formatCentsAsNeeded(cents: number | null | undefined): string {
  const value = Math.round(Number(cents ?? 0));
  return value % 100 === 0 ? formatCents(value) : formatCentsExact(value);
}

/** Loading and empty states share one dash so columns line up. */
export const moneyPlaceholder = "—";

/** `formatCents` unless the value is still loading. */
export function formatCentsOrPlaceholder(
  cents: number | null | undefined,
  loading: boolean,
): string {
  return loading ? moneyPlaceholder : formatCents(cents);
}
