/**
 * What a discount code does to a real price, for the Console's create form
 * (docs/console.md, "Discount codes"). Pure; tests/console-discount.test.ts
 * pins the arithmetic. Money is integer cents.
 */
export type DiscountTerms = {
  percentOff: number | null;
  amountOffCents: number | null;
  duration: "once" | "repeating" | "forever";
  durationMonths: number | null;
};

export type DiscountPreview = {
  listCents: number;
  discountedCents: number;
  /** Billing periods the discount applies to; null means forever. */
  periods: number | null;
  /** Total the studio saves over those periods; per period when forever. */
  savingCents: number;
  summary: string;
};

function dollars(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function describeDiscount(terms: DiscountTerms): string {
  const amount = terms.percentOff ? `${terms.percentOff}% off` : `${dollars(terms.amountOffCents ?? 0).replace(/\.00$/, "")} off`;
  if (terms.duration === "forever") return `${amount} forever`;
  if (terms.duration === "repeating") return `${amount} for ${terms.durationMonths ?? 1} month${terms.durationMonths === 1 ? "" : "s"}`;
  return `${amount} the first payment`;
}

/**
 * The price for one plan and cadence under the terms. A yearly price counts
 * repeating months as whole years (Stripe applies a repeating coupon to every
 * invoice in the window, and a yearly plan invoices once a year).
 */
export function previewDiscount(terms: DiscountTerms, listCents: number, cadence: "monthly" | "yearly"): DiscountPreview {
  const off = terms.percentOff
    ? Math.round((listCents * Math.min(100, Math.max(0, terms.percentOff))) / 100)
    : Math.min(listCents, Math.max(0, terms.amountOffCents ?? 0));
  const discountedCents = listCents - off;
  const unit = cadence === "yearly" ? "yr" : "mo";
  let periods: number | null;
  let span: string;
  if (terms.duration === "once") {
    periods = 1;
    span = "for the first payment";
  } else if (terms.duration === "forever") {
    periods = null;
    span = "for as long as they subscribe";
  } else if (cadence === "yearly") {
    periods = Math.max(1, Math.ceil((terms.durationMonths ?? 1) / 12));
    span = `for the first ${periods === 1 ? "year" : `${periods} years`}`;
  } else {
    periods = Math.max(1, terms.durationMonths ?? 1);
    span = `for ${periods} month${periods === 1 ? "" : "s"}`;
  }
  return {
    listCents,
    discountedCents,
    periods,
    savingCents: periods === null ? off : off * periods,
    summary: `${dollars(listCents)} → ${dollars(discountedCents)} / ${unit} ${span}`,
  };
}
