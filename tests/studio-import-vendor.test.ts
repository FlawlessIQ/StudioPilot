import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { deterministicExtraction } from "../functions/src/studio-import/extraction.ts";
import {
  importedStudioPackage,
  statedDeposit,
} from "../functions/src/studio-import/native-assets.ts";

/**
 * A vendor's price list, imported (the hair walk, Priya Shah, Jess Styles
 * Bridal, 2026-10-10). Jess pasted her list from setup; activation made one
 * package staffed by a photographer, with a $0 deposit, one hour of
 * "coverage", and all five lines run together as its description.
 */
const JESS_PRICE_LIST = [
  "Jess Styles Bridal — 2027 pricing",
  "Bridal hair $375",
  "Bridal hair trial $150",
  "Bridesmaids, mothers and guests $125 per person",
  "Flower girls (under 12) $65 per person",
  "Clip-in extensions, installed on the day $100",
  "A 30% deposit holds the date.",
].join("\n");

/** The draft the AI made of it: five pricing items, and no deposit field. */
const JESS_DRAFT = {
  lineItems: [
    { description: "Bridal hair", amount: "$375" },
    { description: "Bridal hair trial", amount: "$150" },
    { description: "Bridesmaids, mothers and guests", amount: "$125 per person" },
    { description: "Flower girls (under 12)", amount: "$65 per person" },
    { description: "Clip-in extensions, installed on the day", amount: "$100" },
  ],
  options: [],
  exclusions: [],
  currency: "USD",
};

function assertJessPackage(studioPackage: ReturnType<typeof importedStudioPackage>) {
  // A hair stylist, not a photographer.
  assert.deepEqual(studioPackage.includedCoverage, [{ role: "hair_stylist", count: 1 }]);
  assert.equal(studioPackage.includedPhotographers, 0);
  // "A 30% deposit holds the date."
  assert.deepEqual(studioPackage.retainerRule, { type: "percentage", basisPoints: 3000 });
  // Bridal hair is the package; the rest are its extras.
  assert.equal(studioPackage.basePriceCents, 37500);
  assert.deepEqual(studioPackage.includedDeliverables, ["Bridal hair"]);
  assert.doesNotMatch(studioPackage.description, /Bridesmaids|trial|extensions/i);
  assert.deepEqual(
    studioPackage.addOns.map(({ name, unitPriceCents, allowQuantity, unitLabel, taxable, active }) => ({
      name,
      unitPriceCents,
      allowQuantity,
      unitLabel,
      taxable,
      active,
    })),
    [
      { name: "Bridal hair trial", unitPriceCents: 15000, allowQuantity: false, unitLabel: null, taxable: true, active: true },
      { name: "Bridesmaids, mothers and guests", unitPriceCents: 12500, allowQuantity: true, unitLabel: "person", taxable: true, active: true },
      { name: "Flower girls (under 12)", unitPriceCents: 6500, allowQuantity: true, unitLabel: "person", taxable: true, active: true },
      { name: "Clip-in extensions, installed on the day", unitPriceCents: 10000, allowQuantity: false, unitLabel: null, taxable: true, active: true },
    ],
  );
  // Every extra has its own id, under the import's prefix, and a description.
  assert.equal(new Set(studioPackage.addOns.map((addOn) => addOn.id)).size, 4);
  for (const addOn of studioPackage.addOns) {
    assert.match(addOn.id, /^imported_addon_asset_jess_/);
    assert.equal(typeof addOn.description, "string");
  }
  // No hours were stated, so none are written: no "1 hair stylist, 1 hour".
  assert.equal(studioPackage.includedCoverageMinutes, 0);
}

test("Jess's price list, as the AI drafted it, imports as bridal hair with four extras and a 30% deposit", () => {
  const studioPackage = importedStudioPackage({
    name: "Jess Styles Bridal pricing",
    structuredContent: JESS_DRAFT,
    displayOrder: 0,
    trade: "hair",
    // The deposit is only in what she pasted.
    sourceText: JESS_PRICE_LIST,
    addOnIdPrefix: "imported_addon_asset_jess",
  });
  assertJessPackage(studioPackage);
  assert.equal(studioPackage.name, "Jess Styles Bridal pricing");
});

test("the same list read without AI (mock mode) imports the same package", () => {
  const [asset] = deterministicExtraction({ name: "Pasted price list", text: JESS_PRICE_LIST });
  assert.equal(asset?.assetType, "package");
  assertJessPackage(
    importedStudioPackage({
      name: "Pasted price list",
      structuredContent: asset?.structuredContent,
      displayOrder: 0,
      trade: "hair",
      addOnIdPrefix: "imported_addon_asset_jess",
    }),
  );
});

test("other ways the AI words a price list: names and numbers, a unit field, pp, and terms lines", () => {
  const studioPackage = importedStudioPackage({
    name: "Bridal makeup",
    structuredContent: {
      price: 400,
      terms: "Deposit: $100 to hold the date. Balance due on the day.",
      lineItems: [
        { name: "Bridal makeup", description: "Trial-tested look, lashes included", price: 400 },
        { name: "Bridesmaid makeup", price: 140, unit: "person" },
        "Junior bridesmaids $70 pp",
        { name: "Touch-up stay", price: "$90", unit: "per hour" },
        { name: "Deposit", price: "$100" },
        { name: "Balance due", price: "$300" },
      ],
    },
    displayOrder: 1,
    trade: "makeup",
  });
  assert.deepEqual(studioPackage.includedCoverage, [{ role: "makeup_artist", count: 1 }]);
  assert.equal(studioPackage.basePriceCents, 40000);
  assert.deepEqual(studioPackage.retainerRule, { type: "fixed", amountCents: 10000 });
  assert.deepEqual(studioPackage.includedDeliverables, ["Bridal makeup — Trial-tested look, lashes included"]);
  assert.deepEqual(
    studioPackage.addOns.map(({ name, unitPriceCents, unitLabel }) => ({ name, unitPriceCents, unitLabel })),
    [
      { name: "Bridesmaid makeup", unitPriceCents: 14000, unitLabel: "person" },
      { name: "Junior bridesmaids", unitPriceCents: 7000, unitLabel: "person" },
      { name: "Touch-up stay", unitPriceCents: 9000, unitLabel: "hour" },
    ],
  );
});

test("a vendor's list is read for its own crew, and hours only when it states them", () => {
  const hair = importedStudioPackage({
    name: "Bridal party",
    structuredContent: {
      description: "Two stylists for parties over six. Bridal hair and up to five guests.",
      price: 900,
      lineItems: ["Bridal hair and five guests $900"],
    },
    displayOrder: 0,
    trade: "hair",
  });
  assert.deepEqual(hair.includedCoverage, [{ role: "hair_stylist", count: 2 }]);
  assert.equal(hair.includedCoverageMinutes, 0);
  assert.deepEqual(hair.addOns, []);

  const makeup = importedStudioPackage({
    name: "Full party",
    structuredContent: { description: "2 make-up artists on site for 3 hours.", price: 1200, lineItems: [] },
    displayOrder: 0,
    trade: "makeup",
  });
  assert.deepEqual(makeup.includedCoverage, [{ role: "makeup_artist", count: 2 }]);
  assert.equal(makeup.includedCoverageMinutes, 180);

  const dj = importedStudioPackage({
    name: "Reception",
    structuredContent: {
      description: "Two DJs and 5 hours of music. Changes need 48 hours notice.",
      price: 1800,
      lineItems: [],
    },
    displayOrder: 0,
    trade: "dj",
  });
  assert.deepEqual(dj.includedCoverage, [{ role: "dj", count: 2 }]);
  assert.equal(dj.includedCoverageMinutes, 300);

  const noHours = importedStudioPackage({
    name: "Reception",
    structuredContent: { description: "Changes need 48 hours notice.", price: 1800, lineItems: [] },
    displayOrder: 0,
    trade: "dj",
  });
  assert.equal(noHours.includedCoverageMinutes, 0);
  assert.deepEqual(noHours.includedCoverage, [{ role: "dj", count: 1 }]);
});

test("a photographer's import keeps its defaults: one photographer, one hour, one package, no extras", () => {
  for (const trade of [undefined, "photographer"]) {
    const studioPackage = importedStudioPackage({
      name: "Jess",
      structuredContent: JESS_DRAFT,
      displayOrder: 0,
      trade,
    });
    assert.deepEqual(studioPackage.includedCoverage, [{ role: "photographer", count: 1 }]);
    assert.equal(studioPackage.includedPhotographers, 1);
    assert.equal(studioPackage.includedCoverageMinutes, 60);
    assert.equal(studioPackage.basePriceCents, 37500);
    assert.deepEqual(studioPackage.addOns, []);
    assert.equal(studioPackage.includedDeliverables.length, 5);
    assert.equal(
      studioPackage.description,
      "Bridal hair $375. Bridal hair trial $150. Bridesmaids, mothers and guests $125 per person. Flower girls (under 12) $65 per person. Clip-in extensions, installed on the day $100",
    );
    // Nothing stated, nothing invented.
    assert.deepEqual(studioPackage.retainerRule, { type: "fixed", amountCents: 0 });
  }
  const cinema = importedStudioPackage({
    name: "Platinum Cinema Package",
    structuredContent: {
      price: 4599,
      lineItems: ["Two GR Productions Videographers for full day with 10 hours of coverage each."],
    },
    displayOrder: 0,
    trade: "photographer",
  });
  assert.deepEqual(cinema.includedCoverage, [{ role: "videographer", count: 2 }]);
  assert.equal(cinema.includedCoverageMinutes, 600);
});

test("a stated deposit is read from words; a structured field still wins", () => {
  assert.deepEqual(statedDeposit("A 30% deposit holds the date."), { type: "percentage", basisPoints: 3000 });
  assert.deepEqual(statedDeposit("A $500 non-refundable retainer is due at signing."), { type: "fixed", amountCents: 50000 });
  assert.deepEqual(statedDeposit("Booking fee: $100"), { type: "fixed", amountCents: 10000 });
  assert.deepEqual(statedDeposit("Retainer of 50 percent"), { type: "percentage", basisPoints: 5000 });
  // None stated, or two that disagree: nothing is guessed.
  assert.equal(statedDeposit("No deposit — $375 on the day."), null);
  assert.equal(statedDeposit("Bridal hair $375"), null);
  assert.equal(statedDeposit("30% deposit for weddings, $100 deposit for events"), null);

  const withField = importedStudioPackage({
    name: "Bridal hair",
    structuredContent: { ...JESS_DRAFT, retainerPercent: 50 },
    displayOrder: 0,
    trade: "hair",
    sourceText: JESS_PRICE_LIST,
  });
  assert.deepEqual(withField.retainerRule, { type: "percentage", basisPoints: 5000 });
  // "30%" in a retainer field is 30 percent, never $30.
  const asText = importedStudioPackage({
    name: "Bridal hair",
    structuredContent: { ...JESS_DRAFT, retainer: "30%" },
    displayOrder: 0,
    trade: "hair",
  });
  assert.deepEqual(asText.retainerRule, { type: "percentage", basisPoints: 3000 });
});

const source = (path: string) => readFileSync(path, "utf8");

test("activation reads the studio's trade and saves the extras to the add-on library", () => {
  const review = source("functions/src/studio-import/review.ts");
  assert.match(review, /const trade = await tenantTrade\(db, input\.tenantId\);/);
  // Both the first activation and "Sync to library".
  assert.equal(review.match(/importedStudioPackage\(\{[^}]*\btrade,/g)?.length, 2);
  assert.equal(review.match(/db\.doc\(`addOns\/\$\{addOn\.id\}`\)/g)?.length, 2);
});

test("the review screen approves what's on screen and says only what was activated", () => {
  const workspace = source("components/ai/studio-import-review-workspace.tsx");
  // Approve carries an unsaved name and edits with it.
  assert.match(workspace, /name: name\.trim\(\) \|\| selected\.name,/);
  // No list of everything an import could have done.
  assert.doesNotMatch(workspace, /timing rules are active\. Imported messages/);
  assert.match(workspace, /count\("package", "package is", "packages are", "in your library"\)/);
});

test("setup's paste box asks for a price list, not an email", () => {
  const studio = source("components/ai/template-import-studio.tsx");
  assert.match(studio, /label: "Paste your price list"/);
  assert.match(studio, /\{kindCopy\?\.label \?\? "Paste the full message"\}/);
  assert.match(studio, /kindCopy\.placeholder\(depositWord\)/);
});
