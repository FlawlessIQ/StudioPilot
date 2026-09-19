import {
  packageSnapshotSchema,
  type PackageSelection,
  type PackageSnapshot,
  type StudioPackage,
} from "./schema";
import {
  assertCoverageConsistent,
  coverageCount,
  legacyPhotographerCount,
  resolveCoverage,
  type CoverageItem,
  type CoverageRole,
} from "./coverage";

/**
 * How many people a per-crew-member retainer bills for.
 *
 * The rule names the roles it charges for. A rule that names none is a rule
 * written before coverage had roles, and those meant photographers — so that
 * is what they keep meaning, and no existing package changes price.
 *
 * The floor of 1 is inherited: the rule has always charged for at least one
 * crew member.
 */
export function billedCrewCount(
  coverage: readonly CoverageItem[],
  billedRoles: readonly CoverageRole[] | undefined,
): number {
  const roles = billedRoles?.length ? billedRoles : (["photographer"] as const);
  const counted = roles.reduce(
    (sum, role) => sum + coverageCount(coverage, role),
    0,
  );
  return Math.max(1, counted);
}

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
  const coverage = resolveCoverage(input.package);
  const retainerCents =
    input.package.retainerRule.type === "fixed"
      ? Math.min(input.package.retainerRule.amountCents, totalCents)
      : input.package.retainerRule.type === "per_crew_member"
        ? Math.min(
            input.package.retainerRule.amountPerCrewCents *
              billedCrewCount(coverage, input.package.retainerRule.billedRoles),
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
    includedCoverage: coverage,
    includedPhotographers: legacyPhotographerCount(coverage),
    includedDeliverables: [...input.package.includedDeliverables],
    includedTravelArea: input.package.includedTravelArea,
    terms: input.package.terms,
    selectionDate: input.selectedAt,
    selectedBy: input.selectedBy,
    immutable: true,
    createdAt: input.selectedAt,
    createdBy: input.selectedBy,
  });

  assertCoverageConsistent({
    includedCoverage: coverage,
    includedPhotographers: snapshot.includedPhotographers,
  });

  return Object.freeze({
    ...snapshot,
    addOns: Object.freeze(snapshot.addOns.map((addOn) => Object.freeze(addOn))),
    includedDeliverables: Object.freeze([...snapshot.includedDeliverables]),
    includedCoverage: Object.freeze(
      coverage.map((item) => Object.freeze({ ...item })),
    ),
  }) as Readonly<PackageSnapshot>;
}
