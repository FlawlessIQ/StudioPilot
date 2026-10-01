import { pricePackage, type PackageDiscount } from "./package-price.js";

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
  return pricePackage({
    basePriceCents,
    addOns,
    discount,
    // Untaxed as quoted stays untaxed — unless it was untaxed only because a
    // full discount left nothing to tax, which says nothing about the rate.
    taxRateBasisPoints:
      Number(previous.get("taxCents") ?? 0) === 0 && Number(previous.get("subtotalCents") ?? 0) > 0
        ? 0
        : Number(packageDocument.get("taxRateBasisPoints") ?? 0),
    retainerRule:
      rule?.type === "percentage"
        ? { type: "percentage", basisPoints: Number(rule.basisPoints ?? 0) }
        : { type: "fixed", amountCents: Number(previous.get("retainerCents") ?? 0) },
    billedCrew: 1,
  });
}
