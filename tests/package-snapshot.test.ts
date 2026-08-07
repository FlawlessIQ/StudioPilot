import assert from "node:assert/strict";
import test from "node:test";
import { createPackageSnapshot } from "@/features/packages/create-snapshot";
import type { StudioPackage } from "@/features/packages/schema";

const timestamp = "2026-07-26T12:00:00.000Z";
const studioPackage: StudioPackage = {
  id: "package-1",
  tenantId: "tenant-a",
  name: "Signature Wedding",
  description: "Eight hours of documentary wedding coverage.",
  eventTypeId: "wedding",
  eventTypeLabel: "Wedding",
  basePriceCents: 600000,
  currency: "USD",
  retainerRule: { type: "percentage", basisPoints: 3000 },
  includedCoverageMinutes: 480,
  includedPhotographers: 2,
  includedDeliverables: ["Online gallery"],
  includedTravelArea: "Within 50 miles",
  addOns: [{
    id: "album",
    name: "Heirloom album",
    description: "Ten-spread album",
    unitPriceCents: 100000,
    taxable: true,
    active: true,
  }],
  taxRateBasisPoints: 887,
  terms: "Subject to the completed studio agreement.",
  active: true,
  publicVisible: true,
  displayOrder: 1,
  internalNotes: null,
  version: 4,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: "owner",
  updatedBy: "owner",
  archivedAt: null,
};

test("package selection creates an exact immutable price snapshot", () => {
  const snapshot = createPackageSnapshot({
    id: "snapshot-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: studioPackage,
    selection: {
      packageId: "package-1",
      selectedAddOns: [{ addOnId: "album", quantity: 1 }],
      discount: { type: "fixed", amountCents: 50000 },
    },
  });

  assert.equal(snapshot.subtotalCents, 650000);
  assert.equal(snapshot.taxCents, 57655);
  assert.equal(snapshot.totalCents, 707655);
  assert.equal(snapshot.retainerCents, 212297);
  assert.equal(snapshot.packageVersion, 4);
  assert.equal(snapshot.immutable, true);
  assert.equal(Object.isFrozen(snapshot), true);
});

test("later package edits do not change an existing snapshot", () => {
  const mutablePackage = structuredClone(studioPackage);
  const snapshot = createPackageSnapshot({
    id: "snapshot-2",
    tenantId: "tenant-a",
    projectId: "project-2",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: mutablePackage,
    selection: {
      packageId: "package-1",
      selectedAddOns: [],
      discount: { type: "none" },
    },
  });
  mutablePackage.basePriceCents = 900000;
  mutablePackage.includedDeliverables.push("Album");

  assert.equal(snapshot.basePriceCents, 600000);
  assert.deepEqual(snapshot.includedDeliverables, ["Online gallery"]);
});

test("snapshot rejects unavailable add-ons and cross-tenant packages", () => {
  assert.throws(() => createPackageSnapshot({
    id: "snapshot-3",
    tenantId: "tenant-a",
    projectId: "project-3",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: studioPackage,
    selection: {
      packageId: "package-1",
      selectedAddOns: [{ addOnId: "missing", quantity: 1 }],
      discount: { type: "none" },
    },
  }), /unavailable/);

  assert.throws(() => createPackageSnapshot({
    id: "snapshot-4",
    tenantId: "tenant-b",
    projectId: "project-4",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: studioPackage,
    selection: {
      packageId: "package-1",
      selectedAddOns: [],
      discount: { type: "none" },
    },
  }), /tenant/);
});

test("per-crew-member retainers scale with included photographers", () => {
  const perCrewPackage = structuredClone(studioPackage);
  perCrewPackage.retainerRule = {
    type: "per_crew_member",
    amountPerCrewCents: 100000,
  };
  perCrewPackage.includedPhotographers = 3;
  perCrewPackage.taxRateBasisPoints = 0;
  const snapshot = createPackageSnapshot({
    id: "snapshot-5",
    tenantId: "tenant-a",
    projectId: "project-5",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: perCrewPackage,
    selection: {
      packageId: "package-1",
      selectedAddOns: [],
      discount: { type: "none" },
    },
  });
  // $1,000 per crew member × 3 crew = $3,000 retainer.
  assert.equal(snapshot.retainerCents, 300000);

  // The retainer never exceeds the package total.
  const tinyPackage = structuredClone(perCrewPackage);
  tinyPackage.basePriceCents = 150000;
  const capped = createPackageSnapshot({
    id: "snapshot-6",
    tenantId: "tenant-a",
    projectId: "project-6",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: tinyPackage,
    selection: {
      packageId: "package-1",
      selectedAddOns: [],
      discount: { type: "none" },
    },
  });
  assert.equal(capped.retainerCents, 150000);
});
