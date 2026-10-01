/**
 * What the studio is shown for a bill held in QuickBooks before it goes.
 *
 * QuickBooks is the sales-tax authority for a studio switched on to itemised
 * invoices: every final bill (and a retainer, when the studio asked) is made
 * in QuickBooks unsent, QuickBooks' tax is read back, and the record carries
 * `sendReview` (functions/src/operations/quickbooks-held-invoice.ts). This
 * turns that record into the rows and buttons of "Check and send":
 *
 *   Packages $X · Discount −$D · Retainer received −$Y
 *   · Sales tax $Z (calculated by QuickBooks for Austin, TX) · Balance due $T
 *   [Send with tax] [Send without tax] [Edit]
 *
 * Display only. What is sent is decided on the server (bookingCommand
 * sendHeldInvoice), which checks the figure the studio confirmed.
 */

type Row = Record<string, unknown>;

const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const cents = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

export type HeldInvoiceState = "awaiting_studio" | "releasing" | "recalculating" | "sent";

export type HeldInvoiceRow = {
  key: "retainer" | "packages" | "discount" | "retainer_received" | "payments_received" | "sales_tax" | "balance_due";
  label: string;
  cents: number;
  /** "calculated by QuickBooks for Austin, TX" — beside the label. */
  note: string | null;
};

export type HeldInvoiceView = {
  invoiceId: string;
  kind: "final" | "retainer";
  state: HeldInvoiceState;
  rows: HeldInvoiceRow[];
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  /** "Send with tax" can't go: QuickBooks had no address to tax from. */
  sendWithTaxBlocked: boolean;
  billingAddressMissing: boolean;
  /** "Send without tax" is worth offering: there is tax to take off. */
  offerWithoutTax: boolean;
  /** Anything QuickBooks or StudioCue needs the studio to know first. */
  note: string | null;
  /** The last choice didn't go through, in words. */
  lastError: string | null;
};

/** "Austin, TX", "TX", or null. */
export function taxPlace(location: unknown): string | null {
  const value = record(location);
  const parts = [text(value.city), text(value.region)].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/** Where the tax figure came from, for the line beside it. */
export function salesTaxNote(review: Row): string | null {
  const strategy = text(review.strategy);
  if (strategy === "automated") {
    const place = taxPlace(review.taxLocation);
    return place ? `calculated by QuickBooks for ${place}` : "calculated by QuickBooks";
  }
  if (strategy === "company_code") {
    const name = text(review.taxCodeName);
    return name ? `QuickBooks rate: ${name}` : "QuickBooks' default rate";
  }
  if (strategy === "estimate") {
    const rate = cents(review.rateBasisPoints);
    return rate > 0 ? `your estimate at ${rate / 100}%` : "your estimate";
  }
  if (strategy === "none") return "not charged on this job";
  return "none — see below";
}

const STATES: HeldInvoiceState[] = ["awaiting_studio", "releasing", "recalculating", "sent"];

/** The held bill's view, or null when the invoice isn't one held this way. */
export function heldInvoiceView(invoice: Row & { id: string }): HeldInvoiceView | null {
  const review = record(invoice.sendReview);
  const state = text(review.state) as HeldInvoiceState;
  if (!STATES.includes(state)) return null;
  // Sent: the review is history, not a decision. Shown only while it is going.
  if (state === "sent") return null;
  if (invoice.status !== "review_required") return null;
  const kind = invoice.kind === "final" ? "final" : "retainer";
  const lines = (Array.isArray(record(invoice.providerLines).lines) ? (record(invoice.providerLines).lines as unknown[]) : []).map(
    record,
  );
  const sumOf = (kinds: string[]) =>
    lines.filter((line) => kinds.includes(text(line.kind))).reduce((total, line) => total + cents(line.amountCents), 0);
  const totalCents = cents(review.totalCents ?? invoice.amountCents);
  const taxCents = cents(review.taxCents);
  const subtotalCents = cents(review.subtotalCents ?? totalCents - taxCents);
  const rows: HeldInvoiceRow[] = [];
  if (kind === "retainer") {
    rows.push({ key: "retainer", label: "Retainer", cents: sumOf(["retainer"]) || subtotalCents, note: null });
  } else {
    const packages = sumOf(["package", "add_on", "amount"]);
    rows.push({ key: "packages", label: "Packages", cents: packages || subtotalCents, note: null });
    const discount = sumOf(["discount"]);
    if (discount) rows.push({ key: "discount", label: "Discount", cents: discount, note: null });
    const retainer = sumOf(["retainer_received"]);
    if (retainer) rows.push({ key: "retainer_received", label: "Retainer received", cents: retainer, note: null });
    const payments = sumOf(["payments_received"]);
    if (payments) rows.push({ key: "payments_received", label: "Payments received", cents: payments, note: null });
    rows.push({ key: "sales_tax", label: "Sales tax", cents: taxCents, note: salesTaxNote(review) });
  }
  rows.push({ key: "balance_due", label: "Balance due", cents: totalCents, note: null });
  const lastAction = record(review.lastAction);
  const error = record(lastAction.error);
  return {
    invoiceId: invoice.id,
    kind,
    state,
    rows,
    totalCents,
    subtotalCents,
    taxCents,
    sendWithTaxBlocked: review.sendWithTaxBlocked === true,
    billingAddressMissing: review.billingAddressMissing === true,
    offerWithoutTax: kind === "final" && taxCents > 0,
    note: text(review.note) || null,
    lastError:
      lastAction.outcome === "failed"
        ? `QuickBooks didn't take that${text(error.message) ? `: ${text(error.message).replace(/^[A-Z_]+:\d+:/, "")}` : "."} Nothing went to the couple. Try again, or use Edit.`
        : null,
  };
}

/** The held bill of this kind on a job, if any. */
export function heldInvoiceOnJob<T extends Row & { id: string }>(
  invoices: readonly T[] | null | undefined,
  projectId: string,
  kind: "final" | "retainer",
): T | null {
  return (
    (invoices ?? []).find(
      (invoice) => invoice.projectId === projectId && invoice.kind === kind && heldInvoiceView(invoice) !== null,
    ) ?? null
  );
}
