/**
 * One proposal, more than one package.
 *
 * A studio selling photography and video on the same wedding holds two
 * packages, and the client should see one document, one total and one payment
 * schedule — not two proposals to reconcile. The reference studio asked for
 * this three times: "clients can pick either a photography package or a
 * videography package or can select a photography and video package. There is
 * no discount but need to be able to put in a discount if i want."
 *
 * So: no automatic bundle discount. The discount stays the studio's own
 * decision, entered per proposal, and is applied once to the combined subtotal
 * rather than split across packages — splitting it would put an arbitrary
 * fraction of a goodwill gesture against each line and make neither total
 * explainable.
 *
 * Money is integer cents throughout, as everywhere else.
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
