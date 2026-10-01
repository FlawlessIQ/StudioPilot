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

import { combinePricedSalesTax } from "../billing/sales-tax-pricing";
import type { PricedSalesTax } from "../pricing/package-price";

export type PackagePricing = {
  packageName: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  retainerCents: number;
  totalCents: number;
  /**
   * The snapshot's sales-tax decision, when QuickBooks works the tax out on
   * the final invoice (../billing/sales-tax-pricing.ts): `taxCents` is then 0
   * and the total pre-tax. Absent for a package priced the old way.
   */
  salesTax?: PricedSalesTax | null;
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
  /** The packages' decisions as one, the estimates added up; absent when none has one. */
  salesTax?: PricedSalesTax;
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
    ...salesTaxOf(packages),
  };
}

/** Present only when a package was priced pre-tax, so every other proposal keeps its exact shape. */
function salesTaxOf(packages: readonly PackagePricing[]): { salesTax?: PricedSalesTax } {
  const salesTax = combinePricedSalesTax(packages.map((entry) => entry.salesTax));
  return salesTax ? { salesTax } : {};
}

/**
 * Combine the packages locked on a job, as their snapshots store them.
 *
 * A snapshot's `subtotalCents` already has that package's discount taken off
 * (`create-snapshot.ts`), and `combinePricing` takes the discount off the
 * combined subtotal. Passing the stored subtotal and the discount together
 * took it off twice: a $500 discount on a $4,500 package quoted $3,500. So the
 * subtotal goes back to what it was before the discount, and the discounts
 * are added up and applied once. Tax and retainer stay as the snapshot
 * computed them, on the discounted amount.
 */
export function combineSnapshotPricing(
  snapshots: readonly (PackagePricing & { discountCents: number })[],
): CombinedPricing {
  return combinePricing(
    snapshots.map(({ discountCents, ...entry }) => ({
      ...entry,
      subtotalCents: entry.subtotalCents + discountCents,
    })),
    snapshots.reduce((sum, entry) => sum + entry.discountCents, 0),
  );
}
