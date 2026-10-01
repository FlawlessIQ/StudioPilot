import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { draftAmendmentInput } from "../functions/src/contracts/amendments";
import { amendmentChangeLines, amendmentMoney, extrasChange } from "../functions/src/booking/amendment-core";
import {
  amendmentOneOffRecords,
  discardedOneOff,
  pricingSourceFor,
  repriceKeptSnapshot,
  signedOneOff,
} from "../functions/src/booking/amendment-packages";
import {
  resolveAddOnLines,
  sameAddOnLines,
  snapshotAddOnLines,
  type AddOnLine,
} from "../functions/src/packages/add-on-lines";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * Extras and one-off packages inside a booking change (GR Productions,
 * 2026-10-01: "For the change the booking option. No option to add on custom
 * stuff. Incase people want to add on later.").
 *
 * After signing, the job's Packages panel refuses extras and one-offs
 * (PACKAGES_LOCKED_AFTER_SIGNING) because the couple signed for what is there.
 * The change the couple signs is where they go. These hold the rules: the
 * signed snapshots are never touched, an agreed retainer is never re-priced,
 * an extra already agreed keeps its price, the couple reads every extra as a
 * line, and a one-off lives and dies with its change.
 */

const read = (path: string) => readFileSync(path, "utf8");
const ids = (() => {
  let n = 0;
  return () => `custom_test_${++n}`;
})();

test("a change takes extras per package and a one-off, and an old payload still parses", () => {
  // What the app sent before this — no extras, no one-off — is still valid.
  const old = draftAmendmentInput.parse({ projectId: "p1", keepPackageSnapshotIds: ["s1"], eventDate: "2027-06-12" });
  assert.deepEqual(old.extras, []);
  assert.equal(old.oneOffPackage, null);

  const full = draftAmendmentInput.parse({
    projectId: "p1",
    keepPackageSnapshotIds: ["s1"],
    addPackageIds: ["film"],
    extras: [
      { packageSnapshotId: "s1", addOns: [{ addOnId: null, name: "Engagement shoot", unitPriceCents: 50_000 }] },
      { packageId: "film", addOns: [{ addOnId: "drone", quantity: 2 }] },
    ],
    oneOffPackage: { name: "Elopement add-on", basePriceCents: 75_000, included: ["Two hours at the ceremony site"] },
  });
  assert.equal(full.extras[0]!.addOns[0]!.quantity, 1, "one by default");
  assert.equal(full.extras[1]!.addOns[0]!.addOnId, "drone");
  assert.equal(full.oneOffPackage?.basePriceCents, 75_000);

  // Extras name exactly one package: one on the job, or one being added.
  for (const extras of [
    [{ addOns: [] }],
    [{ packageSnapshotId: "s1", packageId: "film", addOns: [] }],
  ])
    assert.equal(draftAmendmentInput.safeParse({ projectId: "p1", keepPackageSnapshotIds: ["s1"], extras }).success, false);
  // Money is whole cents, never negative; a quantity is 1–100.
  const extra = (line: Record<string, unknown>) =>
    draftAmendmentInput.safeParse({ projectId: "p1", keepPackageSnapshotIds: ["s1"], extras: [{ packageSnapshotId: "s1", addOns: [line] }] })
      .success;
  assert.equal(extra({ addOnId: null, name: "Shoot", unitPriceCents: -1 }), false);
  assert.equal(extra({ addOnId: null, name: "Shoot", unitPriceCents: 10.5 }), false);
  assert.equal(extra({ addOnId: "a", quantity: 101 }), false);
  // A one-off says what it is, what it costs and what's included.
  for (const oneOffPackage of [
    { name: "E", basePriceCents: 75_000, included: ["Ceremony"] },
    { name: "Elopement", basePriceCents: -5, included: ["Ceremony"] },
    { name: "Elopement", basePriceCents: 75_000, included: [] },
  ])
    assert.equal(draftAmendmentInput.safeParse({ projectId: "p1", keepPackageSnapshotIds: [], oneOffPackage }).success, false);
});

test("an extra already agreed keeps the price it was agreed at; a new one comes from the package or the library", () => {
  const agreed = snapshotAddOnLines({
    addOns: [
      { addOnId: "albums", name: "Parent albums", quantity: 1, unitPriceCents: 30_000, lineTotalCents: 30_000, taxable: true },
      { addOnId: "custom_old", name: "Family shots", quantity: 1, unitPriceCents: 15_000, lineTotalCents: 15_000, taxable: false },
    ],
  });
  // The library entry has since gone up to $450; the couple agreed $300.
  const library = new Map([
    ["albums", { name: "Parent albums", unitPriceCents: 45_000, taxable: true }],
    ["booth", { name: "Photo booth", unitPriceCents: 60_000, taxable: true }],
  ]);
  const lines = resolveAddOnLines(
    [
      { addOnId: "albums", quantity: 2 },
      { addOnId: "drone", quantity: 1 },
      { addOnId: "booth", quantity: 1 },
      { addOnId: null, name: "Family shots", unitPriceCents: 15_000, taxable: false, quantity: 1 },
      { addOnId: null, name: "Engagement shoot", unitPriceCents: 50_000, quantity: 1 },
    ],
    { agreed, suggested: [{ id: "drone", name: "Drone footage", unitPriceCents: 40_000, taxable: true }], library, newCustomId: ids },
  );
  assert.deepEqual(lines[0], { addOnId: "albums", name: "Parent albums", quantity: 2, unitPriceCents: 30_000, lineTotalCents: 60_000, taxable: true });
  assert.equal(lines[1]!.unitPriceCents, 40_000, "the package's suggestion");
  assert.equal(lines[2]!.unitPriceCents, 60_000, "the library");
  assert.equal(lines[3]!.addOnId, "custom_old", "an unchanged one-off extra keeps its id");
  assert.match(lines[4]!.addOnId, /^custom_/);

  assert.throws(
    () => resolveAddOnLines([{ addOnId: "gone", quantity: 1 }], { agreed, suggested: [], library, newCustomId: ids }),
    /ADD_ON_NOT_FOUND/,
  );
  assert.throws(
    () => resolveAddOnLines([{ addOnId: null, name: "Shoot", quantity: 1 }], { agreed, suggested: [], library, newCustomId: ids }),
    /CUSTOM_ADD_ON_INCOMPLETE/,
  );
  // The extras the job has, sent back as they are, are no change at all.
  const same = resolveAddOnLines(
    [
      { addOnId: null, name: "Family shots", unitPriceCents: 15_000, taxable: false, quantity: 1 },
      { addOnId: "albums", quantity: 1 },
    ],
    { agreed, suggested: [], library, newCustomId: ids },
  );
  assert.equal(sameAddOnLines(agreed, same), true);
  assert.equal(sameAddOnLines(agreed, lines), false);
  // Both refusals read as words, not codes.
  for (const code of ["ADD_ON_NOT_FOUND", "CUSTOM_ADD_ON_INCOMPLETE", "ONE_OFF_PACKAGE_NEEDS_OWNER", "ONE_OFF_PACKAGE_NEEDS_DETAIL", "NOTHING_TO_CHANGE"])
    assert.doesNotMatch(friendlyError(new Error(code)), /[A-Z]{3,}_[A-Z]{3,}/, code);
});

const engagement: AddOnLine = {
  addOnId: "custom_e",
  name: "Engagement shoot",
  quantity: 1,
  unitPriceCents: 50_000,
  lineTotalCents: 50_000,
  taxable: true,
};

test("extras on a signed package price a new snapshot, and an agreed per-crew retainer is never re-priced", () => {
  const signed = Object.freeze({
    tenantId: "t1",
    projectId: "p1",
    packageId: "gold",
    packageName: "Gold Photo Package",
    basePriceCents: 500_000,
    addOns: [],
    discountRule: { type: "none" },
    discountCents: 0,
    subtotalCents: 500_000,
    taxCents: 0,
    retainerCents: 100_000,
    totalCents: 500_000,
    immutable: true,
  });
  // Two photographers at $500 each was the retainer; today the package says $750 each.
  const next = repriceKeptSnapshot({
    previousId: "s1",
    snapshot: signed,
    packageData: { retainerRule: { type: "per_crew_member", amountPerCrewCents: 75_000 }, taxRateBasisPoints: 800 },
    addOns: [engagement],
    id: "s2",
    amendmentId: "a1",
    actorId: "u1",
    timestamp: "2026-10-01T12:00:00.000Z",
  });
  assert.equal(next.id, "s2");
  assert.equal(next.supersedesSnapshotId, "s1");
  assert.equal(next.amendmentId, "a1");
  assert.equal(next.immutable, true);
  assert.equal(next.totalCents, 550_000);
  assert.equal(next.retainerCents, 100_000, "the per-crew retainer stays what was agreed");
  assert.equal(next.taxCents, 0, "untaxed as quoted stays untaxed");
  assert.equal(next.packageName, "Gold Photo Package");
  assert.deepEqual(next.addOns, [engagement]);
  assert.equal(signed.totalCents, 500_000, "the signed snapshot is untouched");

  // A fixed retainer is kept too; a percentage one follows the package total.
  const fixed = repriceKeptSnapshot({
    previousId: "s1",
    snapshot: signed,
    packageData: { retainerRule: { type: "fixed", amountCents: 200_000 } },
    addOns: [engagement],
    id: "s3",
    amendmentId: "a1",
    actorId: "u1",
    timestamp: "t",
  });
  assert.equal(fixed.retainerCents, 100_000);
  const percentage = repriceKeptSnapshot({
    previousId: "s1",
    snapshot: { ...signed, retainerCents: 125_000 },
    packageData: { retainerRule: { type: "percentage", basisPoints: 2500 } },
    addOns: [{ ...engagement, unitPriceCents: 100_000, lineTotalCents: 100_000 }],
    id: "s4",
    amendmentId: "a1",
    actorId: "u1",
    timestamp: "t",
  });
  assert.equal(percentage.retainerCents, 150_000);

  // An imported booking names no real package: it keeps the tax it was quoted.
  const taxed = { ...signed, packageId: "", subtotalCents: 500_000, taxCents: 40_000, totalCents: 540_000, retainerCents: 135_000 };
  assert.deepEqual(pricingSourceFor(taxed, null), { taxRateBasisPoints: 800 });
  const imported = repriceKeptSnapshot({
    previousId: "s1",
    snapshot: taxed,
    packageData: null,
    addOns: [engagement],
    id: "s5",
    amendmentId: "a1",
    actorId: "u1",
    timestamp: "t",
  });
  assert.equal(imported.taxCents, 44_000);
  assert.equal(imported.totalCents, 594_000);
  assert.equal(imported.retainerCents, 135_000);

  // And the schedule's retainer is still the one agreed: the change bills the rest.
  const money = amendmentMoney({ previousTotalCents: 500_000, newTotalCents: 550_000, agreedRetainerCents: 100_000, paidCents: 100_000 });
  assert.equal(money.retainerCents, 100_000);
  assert.equal(money.finalBalanceCents, 450_000);
});

test("the couple reads every extra and one-off in the change, in plain words", () => {
  const before: AddOnLine[] = [
    { addOnId: "albums", name: "Parent albums", quantity: 1, unitPriceCents: 30_000, lineTotalCents: 30_000, taxable: true },
    { addOnId: "booth", name: "Photo booth", quantity: 1, unitPriceCents: 40_000, lineTotalCents: 40_000, taxable: true },
  ];
  const after: AddOnLine[] = [
    { addOnId: "albums", name: "Parent albums", quantity: 2, unitPriceCents: 30_000, lineTotalCents: 60_000, taxable: true },
    engagement,
  ];
  const lines = amendmentChangeLines({
    previousDate: "2027-06-12",
    newDate: "2027-06-12",
    keptPackages: ["Gold Photo Package"],
    addedPackages: [],
    removedPackages: [],
    addedOneOffs: [{ name: "Elopement add-on", priceCents: 75_000 }],
    extras: [extrasChange("Gold Photo Package", before, after)],
    money: amendmentMoney({ previousTotalCents: 600_000, newTotalCents: 700_000, agreedRetainerCents: 150_000, paidCents: 150_000 }),
  });
  assert.deepEqual(lines, [
    "Elopement add-on (one-off, $750) is added.",
    "Engagement shoot is added to Gold Photo Package ($500).",
    "Parent albums on Gold Photo Package changes from 1 to 2 ($600).",
    "Photo booth is removed from Gold Photo Package.",
    "The total changes from $6,000 to $7,000.",
    "$1,500 already paid is kept and counts toward the new total.",
    "$5,500 remains to be paid.",
  ]);
  // Extras on a package the change adds read under that package.
  const added = extrasChange("Highlight Film", [], [{ ...engagement, name: "Drone footage", quantity: 2, lineTotalCents: 80_000 }]);
  assert.deepEqual(added.added.map((line) => line.quantity), [2]);
  const filmLines = amendmentChangeLines({
    previousDate: "2027-06-12",
    newDate: "2027-06-12",
    keptPackages: [],
    addedPackages: ["Highlight Film"],
    removedPackages: [],
    extras: [added],
    money: amendmentMoney({ previousTotalCents: 0, newTotalCents: 0, agreedRetainerCents: 0, paidCents: 0 }),
  });
  assert.deepEqual(filmLines, ["Highlight Film is added.", "Drone footage ×2 is added to Highlight Film ($800)."]);
});

test("a one-off written in the change waits, inactive, for the couple's signature", () => {
  const { packageRecord, snapshotRecord } = amendmentOneOffRecords({
    given: { name: "Elopement add-on", basePriceCents: 75_000, included: ["Two hours at the ceremony site", "Online gallery"] },
    packageId: "pk1",
    snapshotId: "sn1",
    tenantId: "t1",
    projectId: "p1",
    amendmentId: "a1",
    actorId: "u1",
    timestamp: "2026-10-01T12:00:00.000Z",
    mode: "add",
    // Beside a $6,000 package with a $1,500 retainer: a quarter, not $1,500 again.
    mainSnapshot: { totalCents: 600_000, retainerCents: 150_000, includedCoverageMinutes: 480, terms: "Studio terms here" },
    mainPackage: { retainerRule: { type: "fixed", amountCents: 150_000 }, taxRateBasisPoints: 0 },
    catalogue: [],
    tenantCurrency: "USD",
    eventTypeId: "wedding",
    eventTypeLabel: "Wedding",
  });
  assert.equal(packageRecord.active, false, "no list offers it before the couple signs");
  assert.equal(packageRecord.publicVisible, false);
  assert.deepEqual(packageRecord.oneOff, { projectId: "p1", amendmentId: "a1", createdAt: "2026-10-01T12:00:00.000Z" });
  assert.deepEqual(packageRecord.retainerRule, { type: "percentage", basisPoints: 2500 });
  assert.equal(snapshotRecord.packageId, "pk1");
  assert.equal(snapshotRecord.amendmentId, "a1");
  assert.equal(snapshotRecord.oneOff, true);
  assert.equal(snapshotRecord.immutable, true);
  assert.equal(snapshotRecord.totalCents, 75_000);
  assert.equal(snapshotRecord.retainerCents, 18_750);
  assert.deepEqual(snapshotRecord.addOns, []);
  assert.throws(
    () =>
      amendmentOneOffRecords({
        given: { name: "Elopement", basePriceCents: 75_000, included: ["Pics"] },
        packageId: "pk2",
        snapshotId: "sn2",
        tenantId: "t1",
        projectId: "p1",
        amendmentId: "a1",
        actorId: "u1",
        timestamp: "t",
        mode: "add",
        mainSnapshot: null,
        mainPackage: null,
        catalogue: [],
        tenantCurrency: "USD",
        eventTypeId: "wedding",
        eventTypeLabel: "Wedding",
      }),
    /ONE_OFF_PACKAGE_NEEDS_DETAIL/,
  );
  // Signing makes it the job's; withdrawing archives it — never a delete.
  assert.deepEqual(signedOneOff("now", "booking-amendment"), {
    active: true,
    "oneOff.signedAt": "now",
    updatedAt: "now",
    updatedBy: "booking-amendment",
  });
  const discarded = discardedOneOff("now", "u1", "The change was withdrawn.");
  assert.equal(discarded.active, false);
  assert.equal(discarded.archivedAt, "now");
  assert.equal(discarded["oneOff.discardedAt"], "now");
});

test("the records: new snapshots only, a one-off created with its change and discarded with it", () => {
  const amendments = read("functions/src/contracts/amendments.ts");
  const draft = amendments.slice(amendments.indexOf("export async function draftAmendment("), amendments.indexOf("async function liveAmendment("));
  // A one-off sets a price: owner or admin, as createOneOffPackage.
  assert.match(draft, /oneOffInput && !\["studio_owner", "studio_admin"\]\.includes[\s\S]*?ONE_OFF_PACKAGE_NEEDS_OWNER/);
  // Extras only for a package the booking will have.
  assert.match(draft, /if \(!keep\.includes\(entry\.packageSnapshotId\)\) throw new Error\("PACKAGE_NOT_ON_JOB"\)/);
  assert.match(draft, /if \(!input\.addPackageIds\.includes\(entry\.packageId\)\) throw new Error\("PACKAGE_NOT_FOUND"\)/);
  assert.match(draft, /keep\.length \+ input\.addPackageIds\.length \+ \(oneOffInput \? 1 : 0\) > 4/);
  // Extras or a one-off alone are a change.
  assert.match(draft, /!input\.addPackageIds\.length && !repriced\.size && !oneOff\)\s+throw new Error\("NOTHING_TO_CHANGE"\)/);
  // Snapshots are created, never changed: no write to an existing one.
  assert.match(draft, /for \(const entry of repriced\.values\(\)\) batch\.create\(db\.doc\(`packageSnapshots\/\$\{entry\.id\}`\), entry\.record\)/);
  assert.doesNotMatch(amendments, /(batch|transaction)\.(update|set)\(db\.doc\(`packageSnapshots/);
  assert.match(draft, /batch\.create\(db\.doc\(`packages\/\$\{oneOff\.packageId\}`\), oneOff\.packageRecord\)/);
  // Writing the change up again discards the last draft's one-off.
  assert.match(draft, /batch\.update\(previousOneOff\.ref, discardedOneOff\(/);
  assert.match(draft, /oneOffPackageId: oneOff\?\.packageId \?\? null/);
  // Withdrawing discards it, in the same transaction, reading before writing.
  const cancel = amendments.slice(amendments.indexOf("export async function cancelAmendment("));
  const read1 = cancel.indexOf("transaction.get(db.doc(`packages/${oneOffPackageId}`))");
  const write1 = cancel.indexOf("transaction.update(oneOffPackage.ref, discardedOneOff(");
  assert.ok(read1 > 0 && write1 > read1, "the one-off is read, then archived");
  assert.ok(write1 < cancel.indexOf("transaction.set(db.doc(`emailJobs/amendment_withdrawn_"), "every read comes before any write");
  // Signing applies the new snapshots as the job's packages, and the one-off becomes active.
  const apply = read("functions/src/booking/amendment-apply.ts");
  assert.match(apply, /oneOffPackageId \? transaction\.get\(db\.doc\(`packages\/\$\{oneOffPackageId\}`\)\) : Promise\.resolve\(null\)/);
  assert.match(apply, /transaction\.update\(oneOffPackage\.ref, signedOneOff\(now, ACTOR\)\)/);
  assert.match(apply, /packageSnapshotId: nextIds\[0\]/);
  // The final balance reads the amended proposal's total once it is accepted.
  assert.match(read("functions/src/booking/final-invoice.ts"), /accepted\?\.get\("pricingSnapshot"\)/);
  // The agreement lists each package's extras (contracts/sources.ts).
  assert.match(read("functions/src/contracts/sources.ts"), /\.\.\.contractExtras\(data\.addOns, currency\)/);
  // Before signing the Packages panel adds these; after, it still refuses — the change is the way.
  const crm = read("functions/src/crm/commands.ts");
  assert.match(crm, /throw new Error\("PACKAGES_LOCKED_AFTER_SIGNING"\)/);
});

test("the change sheet offers extras on each package and a one-off, with the proposal's own editors", () => {
  const sheet = read("components/booking/booking-amendment.tsx");
  assert.match(sheet, /<JobAddOnsEditor[\s\S]*?allowLibrarySave=\{false\}[\s\S]*?saveLabel="Use these extras"/);
  assert.match(sheet, /<OneOffPackageForm[\s\S]*?forBookingChange/);
  assert.match(sheet, /Write a one-off package/);
  // Only for a package the booking will have, as the server requires.
  assert.match(sheet, /key\.startsWith\("s:"\) \? keptIds\.includes\(key\.slice\(2\)\) : add\.includes\(key\.slice\(2\)\)/);
  // Owner or admin writes a one-off, as the server requires.
  assert.match(sheet, /!oneOff && ownerOrAdmin \?/);
  const form = read("components/proposals/one-off-package-form.tsx");
  assert.match(form, /forBookingChange\s+\? "Add it to the change"/);
  const editor = read("components/proposals/job-add-ons-editor.tsx");
  assert.match(editor, /\{allowLibrarySave \? \(/);
});
