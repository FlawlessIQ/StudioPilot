import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";
import {
  coverageRoleSchema,
  includedCoverageSchema,
} from "@/features/packages/coverage";

const centsSchema = z.number().int().nonnegative().safe();
const basisPointsSchema = z.number().int().min(0).max(10000);

export const packageAddOnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(1000),
  unitPriceCents: centsSchema,
  taxable: z.boolean(),
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
  includedTravelArea: z.string().max(500),
  addOns: z.array(packageAddOnSchema),
  taxRateBasisPoints: basisPointsSchema,
  terms: z.string().min(10).max(5000),
  active: z.boolean(),
  publicVisible: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  internalNotes: z.string().max(3000).nullable(),
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
    }),
  ),
  discountCents: centsSchema,
  subtotalCents: centsSchema,
  taxCents: centsSchema,
  retainerCents: centsSchema,
  totalCents: centsSchema,
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
  includedTravelArea: z.string(),
  terms: z.string(),
  selectionDate: z.string().datetime(),
  selectedBy: z.string().min(1),
  immutable: z.literal(true),
  createdAt: z.string().datetime(),
  createdBy: z.string().min(1),
});

export type PackageSnapshot = z.infer<typeof packageSnapshotSchema>;
