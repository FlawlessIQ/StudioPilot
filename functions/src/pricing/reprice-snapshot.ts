import { pricePackage, type PackageDiscount } from "./package-price.js";
import { readPricedSalesTax, treatmentOf } from "../billing/sales-tax-pricing.js";

/**
 * Anything that answers `get(field)`: a Firestore DocumentSnapshot, or a plain
 * record wrapped by `fieldsOf` (a package document that no longer exists, a
 * test's fixture).
 */
export type FieldSource = { get(field: string): unknown };

export const fieldsOf = (record: Record<string, unknown> | null | undefined): FieldSource => ({
  get: (field: string) => record?.[field],
});

/**
 * A package on a job, priced again from what the couple was already quoted:
 * the snapshot's own base price, with these extras and this discount. A
 * percentage retainer follows the new total; a fixed or per-crew one stays the
 * amount it was — an existing retainer is never re-derived from today's
 * package. Shared by setJobAddOns, setPackageDiscount and updateOneOffPackage
 * (../crm/commands.ts), and by a booking change's extras
 * (../contracts/amendments.ts).
 *
 * Sales tax is priced as the snapshot was: one priced pre-tax "plus sales
 * tax" (its `salesTax`, ../billing/sales-tax-pricing.ts) stays so, with its
 * estimate worked out again at the same rate; one with tax in its total keeps
 * that, whatever the studio's settings say today.
 */
export function repriceSnapshot(
  previous: FieldSource,
  packageDocument: FieldSource,
  addOns: ReadonlyArray<{ unitPriceCents: number; quantity: number; taxable: boolean }>,
  discount: PackageDiscount,
  /** updateOneOffPackage only: the one-off's corrected price. */
  basePriceCents: number = Number(previous.get("basePriceCents") ?? 0),
) {
  const rule = packageDocument.get("retainerRule") as { type?: string; basisPoints?: number } | undefined;
  const salesTax = treatmentOf(readPricedSalesTax(previous.get("salesTax")));
  return pricePackage({
    basePriceCents,
    addOns,
    discount,
    // Untaxed as quoted stays untaxed — unless it was untaxed only because a
    // full discount left nothing to tax, which says nothing about the rate.
    taxRateBasisPoints:
      salesTax || (Number(previous.get("taxCents") ?? 0) === 0 && Number(previous.get("subtotalCents") ?? 0) > 0)
        ? 0
        : Number(packageDocument.get("taxRateBasisPoints") ?? 0),
    retainerRule:
      rule?.type === "percentage"
        ? { type: "percentage", basisPoints: Number(rule.basisPoints ?? 0) }
        : { type: "fixed", amountCents: Number(previous.get("retainerCents") ?? 0) },
    billedCrew: 1,
    salesTax,
  });
}
