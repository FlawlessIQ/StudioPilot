import {
  balanceWithSalesTax,
  readPricedSalesTax,
  SALES_TAX_ESTIMATE_LABEL,
  salesTaxEstimateText,
  salesTaxRateText,
} from "../billing/sales-tax-pricing.js";
import { SCHEDULE_LABELS } from "../job-kinds/job-kinds.js";
import { tradeVocab } from "../trades/trades.js";

/**
 * The rows under a proposal PDF's package lines that take the sum of those
 * lines to its total: the discount and any tax.
 *
 * The PDF listed only the package and extras lines, so a proposal with a 10%
 * discount read $5,000 + $1,500 = $6,200 — the studio page and the agreement
 * both showed the discount, the document the couple downloads did not (UAT F1,
 * 2026-10-01). Pure.
 */
export type PdfAdjustment = { description: string; cents: number };

export function proposalPdfAdjustments(pricing: Record<string, unknown>): PdfAdjustment[] {
  const cents = (value: unknown) => {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? Math.round(number) : 0;
  };
  const adjustments: PdfAdjustment[] = [];
  const discount = cents(pricing.discountCents);
  if (discount > 0) adjustments.push({ description: "Discount", cents: -discount });
  // Tax in the total. A proposal priced pre-tax "plus sales tax" has none
  // here: its estimate is printed under the Total (proposalPdfSalesTax).
  const tax = cents(pricing.taxCents);
  if (tax > 0) adjustments.push({ description: "Tax", cents: tax });
  return adjustments;
}

/** A row the PDF prints under its Total: shown, never added in. */
export type PdfAfterTotalRow = { description: string; amount: string; details: string[] };

/**
 * What a proposal PDF says about sales tax QuickBooks works out on the final
 * invoice (../billing/sales-tax-pricing.ts). The package lines and the
 * Discount row above still add up to the Total, which is pre-tax; the
 * estimate is printed beneath it, said to be not included. A proposal priced
 * the old way gets the plain "Total" and nothing beneath — its tax is the
 * Tax row in proposalPdfAdjustments.
 */
export function proposalPdfSalesTax(
  pricing: Record<string, unknown>,
  currency: string,
): { totalLabel: string; afterTotal: PdfAfterTotalRow[] } {
  const salesTax = readPricedSalesTax(pricing.salesTax);
  if (!salesTax) return { totalLabel: "Total", afterTotal: [] };
  if (salesTax.exempt)
    return { totalLabel: "Total", afterTotal: [{ description: "No sales tax on this booking", amount: "None", details: [] }] };
  const withRate = salesTax.rateBasisPoints !== null;
  return {
    totalLabel: "Total, plus sales tax",
    afterTotal: [
      {
        description: SALES_TAX_ESTIMATE_LABEL,
        amount: withRate ? (salesTaxEstimateText(salesTax, currency) ?? "On final invoice") : "On final invoice",
        details: [
          withRate
            ? `About ${salesTaxRateText(salesTax.rateBasisPoints!)}, worked out from your billing address on your final invoice. Not included in the total above.`
            : "Worked out from your billing address on your final invoice. Not included in the total above.",
        ],
      },
    ],
  };
}

/** A payment's amount on the PDF: the last one is where the sales tax is added. */
export function proposalPdfPaymentAmount(
  pricing: Record<string, unknown>,
  amountText: string,
  isLast: boolean,
): string {
  return isLast ? balanceWithSalesTax(amountText, readPricedSalesTax(pricing.salesTax)) : amountText;
}

/**
 * A payment line's label on the proposal PDF.
 *
 * A proposal's schedule stores the system label "Retainer" for every trade
 * (job-kinds.ts `SCHEDULE_LABELS`), and readers match on it, so the stored
 * line is never rewritten. A DJ's, makeup artist's or hair stylist's client
 * pays a deposit (trades.ts `deposit`), and their quote's PDF printed
 * "Retainer" while the quote page said Deposit (Jess Styles Bridal,
 * 2026-10-12). The same rule as the page's (features/billing/schedule-label.ts
 * `scheduleLineLabel`): a photographer's line, and every other line, reads
 * exactly as stored. The PDF is not the signed agreement, so nothing here is
 * inside a document hash.
 */
export function proposalPdfPaymentLabel(label: string, trade: unknown): string {
  const word = tradeVocab(trade).deposit;
  if (label !== SCHEDULE_LABELS.retainer || word === "retainer") return label;
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * A vendor's payment lines when the proposal has no schedule.
 *
 * The PDF service prints its own "Retainer" and "Final balance" rows when it
 * is sent no schedule (cloud-run/pdf/main.py). A vendor's proposal is sent
 * those two rows instead, in its own word, so the service needs no change:
 * with no due date it fills "On signing" and "As agreed" from the labels, as
 * it does for its own rows. A photographer's is left to the service, as
 * before.
 */
export function proposalPdfUndatedSchedule(
  trade: unknown,
  retainer: string,
  balance: string,
): Array<{ label: string; amount: string; due_date: null }> {
  if (tradeVocab(trade).deposit === "retainer") return [];
  return [
    { label: proposalPdfPaymentLabel(SCHEDULE_LABELS.retainer, trade), amount: retainer, due_date: null },
    { label: SCHEDULE_LABELS.finalBalance, amount: balance, due_date: null },
  ];
}
