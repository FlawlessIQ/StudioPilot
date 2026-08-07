import {
  packageSnapshotSchema,
  type PackageSelection,
  type PackageSnapshot,
  type StudioPackage,
} from "./schema";

function percentageOf(amountCents: number, basisPoints: number): number {
  return Math.round((amountCents * basisPoints) / 10000);
}

export function createPackageSnapshot(input: {
  id: string;
  tenantId: string;
  projectId: string;
  selectedBy: string;
  selectedAt: string;
  package: StudioPackage;
  selection: PackageSelection;
}): Readonly<PackageSnapshot> {
  if (input.package.tenantId !== input.tenantId) {
    throw new Error("Package tenant does not match snapshot tenant.");
  }
  if (input.package.id !== input.selection.packageId) {
    throw new Error("Package selection does not match the package.");
  }

  const addOns = input.selection.selectedAddOns.map((selection) => {
    const definition = input.package.addOns.find(
      (candidate) => candidate.id === selection.addOnId && candidate.active,
    );
    if (!definition) {
      throw new Error(`Add-on ${selection.addOnId} is unavailable.`);
    }
    return {
      addOnId: definition.id,
      name: definition.name,
      quantity: selection.quantity,
      unitPriceCents: definition.unitPriceCents,
      lineTotalCents: definition.unitPriceCents * selection.quantity,
      taxable: definition.taxable,
    };
  });

  const addOnTotalCents = addOns.reduce((sum, addOn) => sum + addOn.lineTotalCents, 0);
  const preDiscountCents = input.package.basePriceCents + addOnTotalCents;
  const requestedDiscountCents =
    input.selection.discount.type === "none"
      ? 0
      : input.selection.discount.type === "fixed"
        ? input.selection.discount.amountCents
        : percentageOf(preDiscountCents, input.selection.discount.basisPoints);
  const discountCents = Math.min(requestedDiscountCents, preDiscountCents);
  const subtotalCents = preDiscountCents - discountCents;
  const taxCents = percentageOf(subtotalCents, input.package.taxRateBasisPoints);
  const totalCents = subtotalCents + taxCents;
  const retainerCents =
    input.package.retainerRule.type === "fixed"
      ? Math.min(input.package.retainerRule.amountCents, totalCents)
      : input.package.retainerRule.type === "per_crew_member"
        ? Math.min(
            input.package.retainerRule.amountPerCrewCents *
              Math.max(1, input.package.includedPhotographers),
            totalCents,
          )
        : percentageOf(totalCents, input.package.retainerRule.basisPoints);

  const snapshot = packageSnapshotSchema.parse({
    id: input.id,
    tenantId: input.tenantId,
    projectId: input.projectId,
    packageId: input.package.id,
    packageVersion: input.package.version,
    packageName: input.package.name,
    description: input.package.description,
    currency: input.package.currency,
    basePriceCents: input.package.basePriceCents,
    addOns,
    discountCents,
    subtotalCents,
    taxCents,
    retainerCents,
    totalCents,
    includedCoverageMinutes: input.package.includedCoverageMinutes,
    includedPhotographers: input.package.includedPhotographers,
    includedDeliverables: [...input.package.includedDeliverables],
    includedTravelArea: input.package.includedTravelArea,
    terms: input.package.terms,
    selectionDate: input.selectedAt,
    selectedBy: input.selectedBy,
    immutable: true,
    createdAt: input.selectedAt,
    createdBy: input.selectedBy,
  });

  return Object.freeze({
    ...snapshot,
    addOns: Object.freeze(snapshot.addOns.map((addOn) => Object.freeze(addOn))),
    includedDeliverables: Object.freeze([...snapshot.includedDeliverables]),
  }) as Readonly<PackageSnapshot>;
}
