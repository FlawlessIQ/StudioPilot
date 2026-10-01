/**
 * A booking change's packages, the pure half: extras on a package already
 * signed for, and a one-off package written for this couple inside the change
 * (GR Productions, 2026-10-01: "For the change the booking option. No option
 * to add on custom stuff. Incase people want to add on later.").
 *
 * After signing, extras and one-offs can't be added on the job's Packages
 * panel — setJobAddOns and createOneOffPackage refuse with
 * PACKAGES_LOCKED_AFTER_SIGNING, because the couple signed for what is there.
 * A booking change is how they are added: the couple signs it.
 *
 * The rules:
 * - a snapshot is never changed. A package whose extras change is priced
 *   again into a new snapshot (`supersedesSnapshotId`), which becomes the
 *   job's only when the change is signed;
 * - priced by repriceSnapshot, as setJobAddOns does: the base price as
 *   quoted, the discount as its rule, and a fixed or per-crew retainer kept at
 *   the amount agreed — never re-derived from today's package;
 * - an extra already agreed keeps the price it was agreed at
 *   (../packages/add-on-lines.ts);
 * - a one-off takes its retainer, tax and terms from the studio's own records
 *   (../packages/one-off.ts), and waits, inactive, until the couple signs.
 *
 * The records side is ../contracts/amendments.ts (draft, withdraw) and
 * ./amendment-apply.ts (signed).
 */
import { pricePackage, type SalesTaxTreatment } from "../pricing/package-price.js";
import { fieldsOf, repriceSnapshot } from "../pricing/reprice-snapshot.js";
import { snapshotDiscountRule } from "../pricing/discount-rule.js";
import { legacyPhotographerCount, type CoverageItem, type CoverageRole } from "../packages/coverage.js";
import {
  oneOffCoverage,
  oneOffCoverageMinutes,
  oneOffDescription,
  oneOffInclusionLines,
  oneOffRetainerRule,
  oneOffTaxRate,
  oneOffTerms,
} from "../packages/one-off.js";
import type { AddOnLine } from "../packages/add-on-lines.js";

type Row = Record<string, unknown>;

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const text = (value: unknown, fallback = "") => (typeof value === "string" && value ? value : fallback);

/** Mirrors billedCrewCount in features/packages/create-snapshot.ts. */
export function billedCrewCount(coverage: readonly CoverageItem[], billedRoles: readonly CoverageRole[] | undefined) {
  const roles = billedRoles?.length ? billedRoles : (["photographer"] as const);
  return Math.max(1, roles.reduce((sum, role) => sum + (coverage.find((item) => item.role === role)?.count ?? 0), 0));
}

/**
 * What a kept package is priced again against: its package document, or —
 * when that is gone (an imported booking names no real package) — the tax
 * rate it was quoted at, so a taxed package doesn't lose its tax.
 */
export function pricingSourceFor(snapshot: Row, packageData: Row | null | undefined): Row {
  if (packageData) return packageData;
  const subtotal = num(snapshot.subtotalCents);
  return { taxRateBasisPoints: subtotal > 0 ? Math.round((num(snapshot.taxCents) * 10000) / subtotal) : 0 };
}

/**
 * A package already on the job with new extras: a new, immutable snapshot
 * superseding the signed one. It is the job's only once the change is signed.
 */
export function repriceKeptSnapshot(input: {
  previousId: string;
  snapshot: Row;
  packageData: Row | null | undefined;
  addOns: AddOnLine[];
  id: string;
  amendmentId: string;
  actorId: string;
  timestamp: string;
}): Row {
  const discountRule = snapshotDiscountRule(input.snapshot);
  const priced = repriceSnapshot(
    fieldsOf(input.snapshot),
    fieldsOf(pricingSourceFor(input.snapshot, input.packageData)),
    input.addOns,
    discountRule,
  );
  return {
    ...input.snapshot,
    id: input.id,
    addOns: input.addOns,
    discountRule,
    discountCents: priced.discountCents,
    subtotalCents: priced.subtotalCents,
    taxCents: priced.taxCents,
    retainerCents: priced.retainerCents,
    totalCents: priced.totalCents,
    // Priced as the signed snapshot was: its sales-tax decision, estimate refreshed.
    ...(priced.salesTax ? { salesTax: priced.salesTax } : {}),
    supersedesSnapshotId: input.previousId,
    // Written for a booking change; it becomes the job's when that is signed.
    amendmentId: input.amendmentId,
    selectionDate: input.timestamp,
    selectedBy: input.actorId,
    immutable: true,
    createdAt: input.timestamp,
    createdBy: input.actorId,
  };
}

export type AmendmentOneOffInput = {
  name: string;
  basePriceCents: number;
  included: string[];
  includedCoverage?: CoverageItem[];
  includedCoverageMinutes?: number;
};

/**
 * The one-off package a change adds: the `packages` document (flagged
 * `oneOff` for this job and this change, and inactive until the couple signs,
 * so no list offers it meanwhile) and the job's snapshot of it. The same
 * records createOneOffPackage writes, from the same defaults.
 */
export function amendmentOneOffRecords(input: {
  given: AmendmentOneOffInput;
  packageId: string;
  snapshotId: string;
  tenantId: string;
  projectId: string;
  amendmentId: string;
  actorId: string;
  timestamp: string;
  /** "add" beside packages the job keeps; "replace" when it keeps none. */
  mode: "add" | "replace";
  mainSnapshot: Row | null;
  mainPackage: Row | null;
  catalogue: readonly Row[];
  tenantCurrency: string;
  eventTypeId: string;
  eventTypeLabel: string;
  /** The signed booking's sales-tax decision (../billing/sales-tax-pricing.ts); null prices the old way. */
  salesTax?: SalesTaxTreatment | null;
}): { packageRecord: Row; snapshotRecord: Row } {
  const included = oneOffInclusionLines(input.given.included);
  if (!included.length || oneOffDescription(included).length < 10) throw new Error("ONE_OFF_PACKAGE_NEEDS_DETAIL");
  const retainerRule = oneOffRetainerRule({
    mode: input.mode,
    mainPackage: input.mainPackage,
    mainSnapshot: input.mainSnapshot,
    catalogue: input.catalogue,
  });
  const taxRateBasisPoints = oneOffTaxRate({ mainPackage: input.mainPackage, catalogue: input.catalogue });
  const terms = oneOffTerms({ mode: input.mode, mainTerms: input.mainSnapshot?.terms });
  const coverage = oneOffCoverage(input.given.includedCoverage);
  const includedCoverageMinutes = oneOffCoverageMinutes(
    input.given.includedCoverageMinutes,
    input.mainSnapshot?.includedCoverageMinutes ?? input.mainPackage?.includedCoverageMinutes,
  );
  const currency =
    input.tenantCurrency.length === 3
      ? input.tenantCurrency
      : text(input.mainSnapshot?.currency, text(input.mainPackage?.currency, "USD")).slice(0, 3) || "USD";
  const description = oneOffDescription(included);
  const priced = pricePackage({
    basePriceCents: input.given.basePriceCents,
    addOns: [],
    discount: { type: "none" },
    taxRateBasisPoints,
    retainerRule,
    billedCrew: retainerRule.type === "per_crew_member" ? billedCrewCount(coverage, retainerRule.billedRoles) : 1,
    salesTax: input.salesTax ?? null,
  });
  const coverageFields = {
    includedCoverage: coverage.map((item) => ({ ...item })),
    includedPhotographers: legacyPhotographerCount(coverage),
  };
  const packageRecord: Row = {
    id: input.packageId,
    tenantId: input.tenantId,
    name: input.given.name,
    description,
    eventTypeId: input.eventTypeId,
    eventTypeLabel: input.eventTypeLabel,
    basePriceCents: input.given.basePriceCents,
    currency,
    retainerRule,
    includedCoverageMinutes,
    ...coverageFields,
    includedDeliverables: included,
    includedTravelArea: "",
    addOns: [],
    taxRateBasisPoints,
    terms,
    // Waits for the couple's signature (./amendment-apply.ts turns it on;
    // withdrawing the change archives it). Inactive, no list offers it.
    active: false,
    publicVisible: false,
    displayOrder: 0,
    internalNotes: null,
    oneOff: { projectId: input.projectId, amendmentId: input.amendmentId, createdAt: input.timestamp },
    version: 1,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    createdBy: input.actorId,
    updatedBy: input.actorId,
    archivedAt: null,
  };
  const snapshotRecord: Row = {
    id: input.snapshotId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    packageId: input.packageId,
    packageVersion: 1,
    packageName: input.given.name,
    description,
    currency,
    basePriceCents: input.given.basePriceCents,
    addOns: [],
    discountRule: { type: "none" },
    discountCents: priced.discountCents,
    subtotalCents: priced.subtotalCents,
    taxCents: priced.taxCents,
    retainerCents: priced.retainerCents,
    totalCents: priced.totalCents,
    ...(priced.salesTax ? { salesTax: priced.salesTax } : {}),
    includedCoverageMinutes,
    ...coverageFields,
    includedDeliverables: included,
    includedTravelArea: "",
    terms,
    oneOff: true,
    amendmentId: input.amendmentId,
    selectionDate: input.timestamp,
    selectedBy: input.actorId,
    immutable: true,
    createdAt: input.timestamp,
    createdBy: input.actorId,
  };
  return { packageRecord, snapshotRecord };
}

/**
 * A change's one-off, discarded with the change: withdrawn, or replaced by
 * writing the change up again. Archived and inactive — never deleted (the
 * per-job purge is the one place a package goes), so the record of what was
 * offered stays. An update to the package document, by dotted path.
 */
export function discardedOneOff(timestamp: string, actorId: string, reason: string): Record<string, unknown> {
  return {
    active: false,
    archivedAt: timestamp,
    "oneOff.discardedAt": timestamp,
    "oneOff.discardedReason": reason,
    updatedAt: timestamp,
    updatedBy: actorId,
  };
}

/** A change's one-off once the couple signed it: the job's, like any package on it. */
export function signedOneOff(timestamp: string, actorId: string): Record<string, unknown> {
  return {
    active: true,
    "oneOff.signedAt": timestamp,
    updatedAt: timestamp,
    updatedBy: actorId,
  };
}
