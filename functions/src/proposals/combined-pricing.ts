/**
 * Mirror of features/proposals/combined-pricing.ts — functions/ is a separate
 * package with no "@/features" path. Compared below the header by
 * tests/combined-pricing.test.ts.
 */

export type PackagePricing = {
  packageName: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  retainerCents: number;
  totalCents: number;
  lineItems: readonly {
    description: string;
    quantity: number;
    unitPriceCents: number;
    totalCents: number;
  }[];
};

export type CombinedPricing = {
  packageName: string;
  currency: string;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  retainerCents: number;
  totalCents: number;
  lineItems: PackagePricing["lineItems"];
};

/**
 * Combine one or more packages into the numbers a proposal carries.
 *
 * `discountCents` is applied to the combined subtotal and clamped to it, the
 * same rule `selectPackage` already applies to a single package — a discount
 * larger than the work is a typo, not a refund.
 */
export function combinePricing(
  packages: readonly PackagePricing[],
  discountCents = 0,
): CombinedPricing {
  if (packages.length === 0) {
    throw new Error("COMBINE_PRICING_REQUIRES_A_PACKAGE");
  }
  const subtotalCents = packages.reduce(
    (sum, entry) => sum + entry.subtotalCents,
    0,
  );
  const discount = Math.min(
    Math.max(0, Math.trunc(discountCents)),
    subtotalCents,
  );
  const taxCents = packages.reduce((sum, entry) => sum + entry.taxCents, 0);
  const retainerCents = packages.reduce(
    (sum, entry) => sum + entry.retainerCents,
    0,
  );
  return {
    /**
     * Both names, because the client is buying both and the document says so.
     * A single package keeps its own name exactly as before.
     */
    packageName: packages.map((entry) => entry.packageName).join(" + "),
    currency: packages[0]!.currency,
    subtotalCents,
    discountCents: discount,
    taxCents,
    retainerCents,
    // The total follows the subtotal, so a discount actually reduces it.
    totalCents: Math.max(0, subtotalCents - discount + taxCents),
    lineItems: packages.flatMap((entry) => entry.lineItems),
  };
}
