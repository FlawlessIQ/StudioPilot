import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";

import {
  combinePricing,
  combineSnapshotPricing,
} from "@/features/proposals/combined-pricing";
import { combineCoverage } from "@/features/packages/coverage";

const photo = {
  packageName: "Signature Collection",
  currency: "USD",
  subtotalCents: 450000,
  taxCents: 0,
  retainerCents: 135000,
  totalCents: 450000,
  lineItems: [
    { description: "Signature Collection", quantity: 1, unitPriceCents: 450000, totalCents: 450000 },
  ],
};
const video = {
  packageName: "Gold Cinematic Package",
  currency: "USD",
  subtotalCents: 379900,
  taxCents: 0,
  retainerCents: 0,
  totalCents: 379900,
  lineItems: [
    { description: "Gold Cinematic Package", quantity: 1, unitPriceCents: 379900, totalCents: 379900 },
  ],
};

test("one package is unchanged by being combined", () => {
  const only = combinePricing([photo]);
  assert.equal(only.packageName, "Signature Collection");
  assert.equal(only.subtotalCents, 450000);
  assert.equal(only.totalCents, 450000);
  assert.equal(only.lineItems.length, 1);
});

test("photo and video become one total the client can read", () => {
  const both = combinePricing([photo, video]);
  assert.equal(both.packageName, "Signature Collection + Gold Cinematic Package");
  assert.equal(both.subtotalCents, 829900);
  assert.equal(both.retainerCents, 135000);
  assert.equal(both.totalCents, 829900);
  // Every line survives, so the client sees what they are buying.
  assert.deepEqual(
    both.lineItems.map((line) => line.description),
    ["Signature Collection", "Gold Cinematic Package"],
  );
});

/** He was explicit: no automatic bundle discount, but he wants to enter one. */
test("there is no bundle discount unless the studio types one", () => {
  assert.equal(combinePricing([photo, video]).discountCents, 0);
  const discounted = combinePricing([photo, video], 50000);
  assert.equal(discounted.discountCents, 50000);
  assert.equal(discounted.totalCents, 779900);
});

test("a discount larger than the work is a typo, not a refund", () => {
  const silly = combinePricing([photo, video], 99999999);
  assert.equal(silly.discountCents, 829900);
  assert.equal(silly.totalCents, 0);
});

test("tax rides on top of the discounted subtotal", () => {
  const taxed = combinePricing(
    [{ ...photo, taxCents: 1000 }, { ...video, taxCents: 500 }],
    100000,
  );
  assert.equal(taxed.taxCents, 1500);
  assert.equal(taxed.totalCents, 829900 - 100000 + 1500);
});

/**
 * A locked snapshot stores its subtotal with the discount already off. Handing
 * that and the discount to combinePricing took it off twice: a $500 discount on
 * a $4,500 package quoted $3,500.
 */
test("a locked package's discount is taken off once, not twice", () => {
  const discountedPhoto = {
    ...photo,
    subtotalCents: 400000,
    discountCents: 50000,
    retainerCents: 120000,
    totalCents: 400000,
  };
  const only = combineSnapshotPricing([discountedPhoto]);
  assert.equal(only.totalCents, 400000);
  assert.equal(only.subtotalCents, 450000);
  assert.equal(only.discountCents, 50000);
  assert.equal(only.retainerCents, 120000);

  const both = combineSnapshotPricing([
    discountedPhoto,
    { ...video, discountCents: 0 },
  ]);
  assert.equal(both.totalCents, 400000 + 379900);
  assert.equal(both.discountCents, 50000);
});

test("tax on a discounted snapshot is kept as the snapshot computed it", () => {
  const taxed = combineSnapshotPricing([
    { ...photo, subtotalCents: 400000, discountCents: 50000, taxCents: 2000, totalCents: 402000 },
  ]);
  assert.equal(taxed.taxCents, 2000);
  assert.equal(taxed.totalCents, 402000);
});

test("an undiscounted snapshot combines exactly as before", () => {
  const both = combineSnapshotPricing([
    { ...photo, discountCents: 0 },
    { ...video, discountCents: 0 },
  ]);
  assert.deepEqual(both, combinePricing([photo, video]));
});

test("combining nothing is a programming error, not an empty proposal", () => {
  assert.throws(() => combinePricing([]), /COMBINE_PRICING_REQUIRES_A_PACKAGE/);
});

/**
 * Two packages describe different work at the same wedding. Taking the larger
 * of each role would send two people to a job that needs four.
 */
test("crew requirements add up rather than overlap", () => {
  const combined = combineCoverage([
    [{ role: "photographer", count: 2 }],
    [{ role: "videographer", count: 2 }],
  ]);
  assert.deepEqual(combined, [
    { role: "photographer", count: 2 },
    { role: "videographer", count: 2 },
  ]);
  const sameRole = combineCoverage([
    [{ role: "photographer", count: 2 }],
    [{ role: "photographer", count: 1 }, { role: "videographer", count: 1 }],
  ]);
  assert.deepEqual(sameRole, [
    { role: "photographer", count: 3 },
    { role: "videographer", count: 1 },
  ]);
});

test("one coverage combined with nothing is itself", () => {
  assert.deepEqual(combineCoverage([[{ role: "videographer", count: 2 }]]), [
    { role: "videographer", count: 2 },
  ]);
  assert.deepEqual(combineCoverage([]), []);
});

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/**
 * functions/ is a separate package with no "@/features" path, so the pricing
 * rule is duplicated there. Compare below the headers.
 */
test("the functions copy of combined pricing matches features/", () => {
  const body = (path: string) => {
    const text = source(path);
    return text.slice(text.indexOf("export type PackagePricing = {"));
  };
  assert.equal(
    body("functions/src/proposals/combined-pricing.ts"),
    body("features/proposals/combined-pricing.ts"),
  );
});

test("the functions copy of coverage still matches features/", () => {
  const body = (path: string) => {
    const text = source(path);
    return text.slice(text.indexOf("export function combineCoverage("));
  };
  assert.equal(
    body("functions/src/packages/coverage.ts"),
    body("features/packages/coverage.ts"),
  );
});

/**
 * The primary package is what the booking gate, readiness and the invoice
 * scheduler resolve. A second package is additive; moving the primary would
 * change what all of them see.
 */
test("adding a package never moves the primary", () => {
  const crm = source("functions/src/crm/commands.ts");
  const block = crm.slice(crm.indexOf('command.input.mode === "add" && hasPrimary'));
  assert.match(block, /additionalPackageSnapshotIds: \[\s*\n?\s*\.\.\.existingAdditional,/);
  // Replacing the primary drops the second, which was priced against it.
  assert.match(block, /additionalPackageSnapshotIds: \[\],/);
});

test("a proposal prices every package on the job", () => {
  const proposals = source("functions/src/booking/proposals.ts");
  assert.match(proposals, /pricingSnapshot: combineSnapshotPricing\(/);
  assert.match(proposals, /discountCents: numberValue\(data\.discountCents\)/);
  assert.match(proposals, /additionalPackageSnapshotIds: additionalSnapshotIds/);
  // A snapshot id is not a capability.
  assert.match(proposals, /snapshot\.get\("tenantId"\) === command\.tenantId/);
});

test("crew is planned for every package on the job", () => {
  const staffing = source("functions/src/crew/prepare-staffing.ts");
  assert.match(staffing, /const coverage = combineCoverage\(\[/);
  assert.match(staffing, /document\.get\("tenantId"\) === input\.tenantId/);
});

test("the document says which trades it is selling, across both packages", () => {
  const pdf = source("functions/src/operations/ai-pdf.ts");
  assert.match(pdf, /additionalPackageSnapshotIds/);
  assert.match(pdf, /snapshots\.flatMap/);
});
