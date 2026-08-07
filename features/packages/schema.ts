import { z } from "zod";
import { auditFieldsSchema } from "@/features/tenants/schema";

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
  // package fields (includedPhotographers), capped at the package total.
  z.object({
    type: z.literal("per_crew_member"),
    amountPerCrewCents: centsSchema,
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
  includedPhotographers: z.number().int().positive(),
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
  includedPhotographers: z.number().int().positive(),
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
