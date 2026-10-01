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
  const tax = cents(pricing.taxCents);
  if (tax > 0) adjustments.push({ description: "Tax", cents: tax });
  return adjustments;
}
