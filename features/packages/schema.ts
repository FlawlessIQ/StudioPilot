import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import {
  coverageRoleSchema,
  includedCoverageSchema,
} from "@/features/packages/coverage";

const centsSchema = z.number().int().nonnegative().safe();
const basisPointsSchema = z.number().int().min(0).max(10000);

/** One structured deliverable a package promises (H4). */
export const packageDeliverableSchema = z.object({
  kind: z.enum(["sneak_peek", "gallery", "highlight_film", "full_film", "teaser", "raw_files", "album", "other"]),
  label: z.string().trim().min(1).max(80),
  turnaroundDays: z.number().int().min(0).max(730),
  final: z.boolean(),
});
export type PackageDeliverable = z.infer<typeof packageDeliverableSchema>;

export const packageAddOnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  unitPriceCents: centsSchema,
  taxable: z.boolean(),
  /** The couple may choose how many (hours, prints). From the library (H2). */
  allowQuantity: z.boolean().optional(),
  /** What it's priced per: "person", "hour" (unit-label.ts). */
  unitLabel: z.string().max(24).nullable().optional(),
  active: z.boolean(),
});

export const retainerRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), amountCents: centsSchema }),
  z.object({ type: z.literal("percentage"), basisPoints: basisPointsSchema }),
  // "I charge $1,000 per crew member" — retainer scales with the crew the
  // package includes, capped at the package total.
  z.object({
    type: z.literal("per_crew_member"),
    amountPerCrewCents: centsSchema,
    /**
     * Which coverage roles the rule bills for. Absent means photographers
     * only, which is exactly what every package written before coverage had
     * roles meant — so no existing package changes price by gaining roles.
     */
    billedRoles: z.array(coverageRoleSchema).min(1).optional(),
  }),
]);

export const packageSchema = auditFieldsSchema.extend({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(3000),
  eventTypeId: z.string().min(1),
  eventTypeLabel: z.string().min(2).max(80),
  basePriceCents: centsSchema,
  currency: z.string().length(3),
  retainerRule: retainerRuleSchema,
  includedCoverageMinutes: z.number().int().positive(),
  /**
   * What the studio sends: {role, count}. Read it via `resolveCoverage`,
   * never directly.
   *
   * Optional because package documents are not migrated: every package
   * written before coverage had roles is still a valid package, and
   * `PackagesRepository` parses those documents straight off Firestore. They
   * gain the field the next time the studio saves them.
   */
  includedCoverage: includedCoverageSchema.optional(),
  /**
   * Legacy. Written beside `includedCoverage` and always equal to its
   * photographer count — zero for a video-only package, which is why this is
   * non-negative where it was once positive. Never read directly.
   */
  includedPhotographers: z.number().int().nonnegative(),
  includedDeliverables: z.array(z.string().min(1)).min(1),
  /**
   * What the package delivers, each with its turnaround (H4,
   * docs/delivery-plan-2026-09-28.md). Optional: without it the job's list
   * comes from coverage and the free text (features/post-event/deliverables.ts),
   * and due dates were a hard-coded 42 days for everything.
   */
  deliverables: z.array(packageDeliverableSchema).max(8).optional(),
  includedTravelArea: z.string().max(500),
  addOns: z.array(packageAddOnSchema),
  taxRateBasisPoints: basisPointsSchema,
  terms: z.string().min(10).max(5000),
  active: z.boolean(),
  publicVisible: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  internalNotes: z.string().max(3000).nullable(),
  /**
   * Written for one job, not kept in the library (createOneOffPackage). Every
   * list of the studio's catalogue leaves it out through
   * `isCataloguePackage` (features/packages/one-off.ts). Absent on a library
   * package.
   */
  oneOff: z.object({ projectId: z.string().min(1), createdAt: z.string().optional() }).optional(),
  version: z.number().int().positive(),
  archivedAt: z.string().datetime().nullable(),
});

export type StudioPackage = z.infer<typeof packageSchema>;

export const packageSelectionSchema = z.object({
  packageId: z.string().min(1),
  selectedAddOns: z.array(
    z.object({
      addOnId: z.string().min(1),
      quantity: z.number().int().positive().max(100),
    }),
  ),
  discount: z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("fixed"), amountCents: centsSchema }),
    z.object({ type: z.literal("percentage"), basisPoints: basisPointsSchema }),
  ]),
});

export type PackageSelection = z.infer<typeof packageSelectionSchema>;

/**
 * The catalogue package a snapshot was taken from — **or the sentinel
 * `IMPORTED_PACKAGE_ID`**, which resolves to no document at all.
 *
 * A booking imported from a signed contract has no catalogue package behind
 * it: the contract *is* the offer. `features/imports/existing-booking.ts`
 * writes `packageId: "imported"` for exactly that reason, so on a studio that
 * has imported its book, a large share of snapshots carry an id that will
 * never resolve.
 *
 * Nothing in the product resolves it — proposal acceptance, the client portal
 * and the invoice scheduler all read the snapshot, which is an immutable copy
 * and self-contained by design; the only read of this field writes it into an
 * audit event's payload. Treat it as a label, not a foreign key: a
 * `db.doc(\`packages/${snapshot.packageId}\`)` would be a not-found on every
 * imported wedding. tests/package-snapshot.test.ts holds that rule.
 */
export const IMPORTED_PACKAGE_ID = "imported";

/**
 * Sales tax QuickBooks works out on the final invoice: the snapshot's price
 * is pre-tax and this records the decision and the estimate
 * (features/billing/sales-tax-pricing.ts). Absent on a snapshot priced the
 * old way, whose `taxCents` is in its total.
 */
export const pricedSalesTaxSchema = z.object({
  mode: z.literal("quickbooks"),
  exempt: z.boolean(),
  estimatedCents: centsSchema,
  rateBasisPoints: z.number().int().min(0).max(10000).nullable(),
});

export const packageSnapshotSchema = z.object({
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  packageId: z.string().min(1),
  packageVersion: z.number().int().positive(),
  packageName: z.string().min(1),
  description: z.string(),
  currency: z.string().length(3),
  basePriceCents: centsSchema,
  addOns: z.array(
    z.object({
      addOnId: z.string().min(1),
      name: z.string().min(1),
      quantity: z.number().int().positive(),
      unitPriceCents: centsSchema,
      lineTotalCents: centsSchema,
      taxable: z.boolean(),
      /** What it's priced per: "person", "hour" (unit-label.ts). */
      unitLabel: z.string().max(24).nullable().optional(),
    }),
  ),
  discountCents: centsSchema,
  subtotalCents: centsSchema,
  taxCents: centsSchema,
  retainerCents: centsSchema,
  totalCents: centsSchema,
  salesTax: pricedSalesTaxSchema.optional(),
  includedCoverageMinutes: z.number().int().positive(),
  /**
   * Optional only because snapshots are immutable: every proposal signed
   * before coverage had roles carries the legacy field alone, forever.
   * `resolveCoverage` answers for both shapes.
   */
  includedCoverage: includedCoverageSchema.optional(),
  /** Legacy, written beside `includedCoverage`. See the package schema. */
  includedPhotographers: z.number().int().nonnegative(),
  includedDeliverables: z.array(z.string()),
  /** Copied from the package when it had one; see the package schema. */
  deliverables: z.array(packageDeliverableSchema).optional(),
  includedTravelArea: z.string(),
  terms: z.string(),
  selectionDate: z.string().datetime(),
  selectedBy: z.string().min(1),
  immutable: z.literal(true),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
});

export type PackageSnapshot = z.infer<typeof packageSnapshotSchema>;
