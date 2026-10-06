import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertCoverageConsistent,
  coverageFromPhotographerCount,
  coverageRoleLabel,
  describeCoverage,
  includedCoverageSchema,
  legacyPhotographerCount,
  normaliseCoverage,
  resolveCoverage,
  totalCoverageCount,
} from "@/features/packages/coverage";
import {
  billedCrewCount,
  createPackageSnapshot,
} from "@/features/packages/create-snapshot";
import { packageSchema } from "@/features/packages/schema";
import type { StudioPackage } from "@/features/packages/schema";
import {
  existingBookingSchema,
  importedCoverage,
} from "@/features/imports/existing-booking";

const timestamp = "2026-09-19T12:00:00.000Z";

const studioPackage: StudioPackage = {
  id: "package-1",
  tenantId: "tenant-a",
  name: "Cinematic Wedding",
  description: "A full day of coverage, shot for film.",
  eventTypeId: "wedding",
  eventTypeLabel: "Wedding",
  basePriceCents: 600000,
  currency: "USD",
  retainerRule: { type: "percentage", basisPoints: 3000 },
  includedCoverageMinutes: 600,
  includedCoverage: [{ role: "photographer", count: 2 }],
  includedPhotographers: 2,
  includedDeliverables: ["Online gallery"],
  includedTravelArea: "Within 50 miles",
  addOns: [],
  taxRateBasisPoints: 0,
  terms: "Subject to the completed studio agreement.",
  active: true,
  publicVisible: true,
  displayOrder: 1,
  internalNotes: null,
  version: 1,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdBy: "owner",
  updatedBy: "owner",
  archivedAt: null,
};

const snapshotOf = (overrides: Partial<StudioPackage>) =>
  createPackageSnapshot({
    id: "snapshot-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    selectedBy: "owner",
    selectedAt: timestamp,
    package: { ...studioPackage, ...overrides },
    selection: { packageId: "package-1", selectedAddOns: [], discount: { type: "none" } },
  });

test("a package can be counted in videographers", () => {
  const snapshot = snapshotOf({
    includedCoverage: [{ role: "videographer", count: 2 }],
    includedPhotographers: 0,
  });
  assert.deepEqual(snapshot.includedCoverage, [
    { role: "videographer", count: 2 },
  ]);
  assert.equal(describeCoverage(snapshot.includedCoverage ?? []), "2 videographers");
});

test("coverage is written in display order, whatever order it arrives in", () => {
  assert.deepEqual(
    normaliseCoverage([
      { role: "videographer", count: 1 },
      { role: "photographer", count: 2 },
    ]),
    [
      { role: "photographer", count: 2 },
      { role: "videographer", count: 1 },
    ],
  );
});

test("one role may not be counted twice", () => {
  assert.equal(
    includedCoverageSchema.safeParse([
      { role: "photographer", count: 1 },
      { role: "photographer", count: 2 },
    ]).success,
    false,
  );
});

test("a package that sends nobody is not a package", () => {
  assert.equal(includedCoverageSchema.safeParse([]).success, false);
});

/**
 * The fallback read is permanent, not transitional: snapshots are immutable,
 * so every proposal signed before coverage had roles carries the old shape
 * forever.
 */
test("a record written before roles reads as photographers", () => {
  assert.deepEqual(resolveCoverage({ includedPhotographers: 3 }), [
    { role: "photographer", count: 3 },
  ]);
  assert.deepEqual(resolveCoverage({ includedPhotographers: 0 }), [
    { role: "photographer", count: 1 },
  ]);
});

test("coverage is read off anything, including a record with neither field", () => {
  const one = [{ role: "photographer" as const, count: 1 }];
  assert.deepEqual(resolveCoverage(null), one);
  assert.deepEqual(resolveCoverage(undefined), one);
  assert.deepEqual(resolveCoverage("not a record"), one);
  assert.deepEqual(resolveCoverage({}), one);
  // Malformed coverage falls back rather than throwing at a client.
  assert.deepEqual(
    resolveCoverage({ includedCoverage: [{ role: "drone", count: 1 }], includedPhotographers: 2 }),
    [{ role: "photographer", count: 2 }],
  );
});

test("the legacy number is exactly the photographer count", () => {
  assert.equal(legacyPhotographerCount([{ role: "videographer", count: 2 }]), 0);
  assert.equal(
    legacyPhotographerCount([
      { role: "photographer", count: 2 },
      { role: "videographer", count: 1 },
    ]),
    2,
  );
});

/** Two fields describing one fact is the shape that goes quietly wrong. */
test("the dual write cannot drift", () => {
  assert.throws(
    () =>
      assertCoverageConsistent({
        includedCoverage: [{ role: "photographer", count: 2 }],
        includedPhotographers: 3,
      }),
    /disagrees with coverage/,
  );
  const snapshot = snapshotOf({
    includedCoverage: [
      { role: "photographer", count: 1 },
      { role: "videographer", count: 2 },
    ],
    // Deliberately wrong on the way in; the snapshot derives it, never copies.
    includedPhotographers: 9,
  });
  assert.equal(snapshot.includedPhotographers, 1);
});

test("a package's legacy field is never trusted over its coverage", () => {
  const snapshot = snapshotOf({
    includedCoverage: [{ role: "videographer", count: 3 }],
    includedPhotographers: 3,
  });
  assert.equal(snapshot.includedPhotographers, 0);
  assert.equal(totalCoverageCount(snapshot.includedCoverage ?? []), 3);
});

// --- the retainer -------------------------------------------------------

/**
 * The decision that had to be made deliberately: "per crew member" on a
 * multi-role package could mean everyone or photographers only, and either
 * answer silently repriced somebody. A rule naming no roles keeps meaning
 * photographers, so no package written before this change moves.
 */
test("a per-crew rule with no roles named still bills photographers only", () => {
  assert.equal(
    billedCrewCount(
      [
        { role: "photographer", count: 2 },
        { role: "videographer", count: 2 },
      ],
      undefined,
    ),
    2,
  );
});

test("a per-crew rule bills the roles the studio picked", () => {
  const coverage = [
    { role: "photographer" as const, count: 2 },
    { role: "videographer" as const, count: 2 },
  ];
  assert.equal(billedCrewCount(coverage, ["photographer", "videographer"]), 4);
  assert.equal(billedCrewCount(coverage, ["videographer"]), 2);
});

test("a per-crew rule always bills for at least one person", () => {
  assert.equal(
    billedCrewCount([{ role: "videographer", count: 2 }], ["photographer"]),
    1,
  );
});

test("the retainer follows the billed roles into the snapshot", () => {
  const snapshot = snapshotOf({
    retainerRule: {
      type: "per_crew_member",
      amountPerCrewCents: 100000,
      billedRoles: ["photographer", "videographer"],
    },
    includedCoverage: [
      { role: "photographer", count: 1 },
      { role: "videographer", count: 2 },
    ],
    includedPhotographers: 1,
  });
  assert.equal(snapshot.retainerCents, 300000);
});

test("an existing per-crew package keeps the retainer it had", () => {
  const snapshot = snapshotOf({
    retainerRule: { type: "per_crew_member", amountPerCrewCents: 100000 },
    // Exactly how a package written before roles is stored.
    includedCoverage: undefined,
    includedPhotographers: 3,
  });
  assert.equal(snapshot.retainerCents, 300000);
});

// --- reading and writing records ---------------------------------------

/**
 * `PackagesRepository` parses live Firestore documents, and no package is
 * migrated — so a package with no coverage field is still a valid package.
 */
test("a package document written before roles still parses", () => {
  const legacy: Record<string, unknown> = { ...studioPackage };
  delete legacy.includedCoverage;
  assert.equal(packageSchema.safeParse(legacy).success, true);
});

test("a video-only package parses, with zero photographers", () => {
  assert.equal(
    packageSchema.safeParse({
      ...studioPackage,
      includedCoverage: [{ role: "videographer", count: 2 }],
      includedPhotographers: 0,
    }).success,
    true,
  );
});

test("an imported booking carries both counts", () => {
  assert.deepEqual(
    importedCoverage({ photographers: 1, videographers: 2 }),
    [
      { role: "photographer", count: 1 },
      { role: "videographer", count: 2 },
    ],
  );
  assert.deepEqual(importedCoverage({ photographers: 0, videographers: 2 }), [
    { role: "videographer", count: 2 },
  ]);
  // A contract recording nobody imports as one photographer, as it always has.
  assert.deepEqual(importedCoverage({ photographers: 0, videographers: 0 }), [
    { role: "photographer", count: 1 },
  ]);
});

test("a booking imported before videographers existed is still valid", () => {
  const booking = {
    clients: [{ firstName: "Iris", lastName: "Hale", email: "iris@example.com", phone: null }],
    projectName: null,
    eventTypeId: "wedding",
    eventType: "Wedding",
    eventDate: "2027-05-01",
    timezone: "America/New_York",
    venueName: null,
    city: null,
    state: "BOOKED",
    packageName: "Signature",
    coverageMinutes: 480,
    photographers: 2,
    currency: "USD",
    totalCents: 600000,
    taxCents: 0,
    signedOn: "2026-01-10",
    signerName: "Iris Hale",
    hasSignedCopy: true,
    payments: [],
    notes: null,
  };
  const parsed = existingBookingSchema.safeParse(booking);
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.videographers, undefined);
});

// --- what the couple reads ---------------------------------------------

test("coverage reads as a sentence, and never names a role it does not include", () => {
  assert.equal(describeCoverage([{ role: "photographer", count: 1 }]), "1 photographer");
  assert.equal(
    describeCoverage([
      { role: "photographer", count: 2 },
      { role: "videographer", count: 1 },
    ]),
    "2 photographers and 1 videographer",
  );
  assert.equal(describeCoverage([]), "");
  assert.equal(
    describeCoverage([{ role: "videographer", count: 2 }]).includes("photograph"),
    false,
  );
});

test("role labels are singular for one and plural for the rest", () => {
  assert.equal(coverageRoleLabel("videographer", 1), "videographer");
  assert.equal(coverageRoleLabel("videographer", 2), "videographers");
});

test("coverage from a photographer count never sends nobody", () => {
  assert.deepEqual(coverageFromPhotographerCount(0), [
    { role: "photographer", count: 1 },
  ]);
});

/**
 * functions/ is a separate package with no "@/features" path, so the module
 * is duplicated. Compare the two copies below their headers.
 */
test("the functions copy of coverage matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export const coverageRoleSchema"));
  };
  assert.equal(
    body("functions/src/packages/coverage.ts"),
    body("features/packages/coverage.ts"),
  );
});

// --- a per-crew retainer that counts nobody (GR, 2026-10-06) -----------------
import { crewTheRuleCounts, perCrewRetainerProblem } from "@/features/packages/retainer-check";
import { billedCrewCount as snapshotBilledCrew } from "@/features/packages/create-snapshot";

test("a per-crew retainer counting nobody on its own package is caught, not silently billed as one person", () => {
  // GR's Gold Cinematic: two videographers, "$1,000 per crew" — per photographer.
  const video = [{ role: "videographer" as const, count: 2 }];
  assert.equal(crewTheRuleCounts(video, ["photographer"]), 0);
  // The floor of one is unchanged — changing it would reprice live packages.
  assert.equal(snapshotBilledCrew(video, ["photographer"]), 1);
  assert.match(
    perCrewRetainerProblem({ coverage: video, billedRoles: ["photographer"] }) ?? "",
    /charged per photographer, but this package has no photographers — only videographers/,
  );
  assert.equal(perCrewRetainerProblem({ coverage: video, billedRoles: ["videographer"] }), null);
  assert.equal(perCrewRetainerProblem({ coverage: video, billedRoles: ["photographer", "videographer"] }), null);
  // A legacy rule (no roles) on a photo package still means photographers, and is fine.
  assert.equal(perCrewRetainerProblem({ coverage: [{ role: "photographer", count: 2 }], billedRoles: undefined }), null);
});

test("the editor, the create form and the server all refuse it; the list and the proposal show it", () => {
  const editor = readFileSync("components/crm/edit-package-form.tsx", "utf8");
  // Switching to per-crew starts on everyone the package sends.
  assert.match(editor, /: Number\(videographers \|\| 0\) > 0\);/);
  assert.match(editor, /if \(perCrewProblem\) \{\s*setError\(perCrewProblem\);/);
  assert.match(readFileSync("components/crm/create-package-form.tsx", "utf8"), /perCrewRetainerProblem\(\{/);
  const server = readFileSync("functions/src/crm/commands.ts", "utf8");
  assert.match(server, /throw new Error\("PER_CREW_RETAINER_BILLS_NOBODY"\)/);
  assert.match(server, /assertPerCrewCountsSomeone\(command\.input\.retainerRule, coverageFromInput\(command\.input\)\)/);
  assert.match(server, /if \(patch\.retainerRule !== undefined \|\| patch\.includedCoverage !== undefined\) \{\s*assertPerCrewCountsSomeone\(/);
  assert.match(readFileSync("lib/ai/friendly-error.ts", "utf8"), /PER_CREW_RETAINER_BILLS_NOBODY:/);
  assert.match(readFileSync("components/studio/live-domain-view.tsx", "utf8"), /none on this package, so it charges for one person/);
  assert.match(readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8"), /`From the packages: \$\{allSnapshots/);
});
