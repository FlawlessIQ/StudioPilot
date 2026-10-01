import {
  balanceWithSalesTax,
  readPricedSalesTax,
  SALES_TAX_ESTIMATE_LABEL,
  salesTaxEstimateText,
  salesTaxRateText,
} from "../billing/sales-tax-pricing.js";

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
