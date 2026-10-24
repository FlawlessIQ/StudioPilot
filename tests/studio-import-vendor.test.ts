import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { activationSummary, approvalEdits } from "../features/studio-import/review-actions.ts";
import { statedCoverageMinutes } from "../functions/src/packages/job-package-facts.ts";
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

/**
 * The review of the first fix (2026-10-10): a deposit read across a line
 * break or across two of the draft's fields, a deposit given as a line
 * item, a per-stylist ratio read as crew, and a photographer whose import
 * changed when it must not.
 */
test("a price on one line is never the deposit the next line names", () => {
  assert.equal(statedDeposit("Full day $3,000\nRetainer required to book."), null);
  assert.equal(statedDeposit("Gold collection 30%\nDeposit holds the date"), null);
  // Each text on its own: two fields, two answers, nothing guessed.
  assert.equal(statedDeposit("Gold collection $3,500", "Retainer secures your date"), null);
  assert.deepEqual(statedDeposit("Bridal hair $375", "A 30% deposit holds the date."), {
    type: "percentage",
    basisPoints: 3000,
  });

  const gold = {
    price: 3500,
    lineItems: [{ description: "Gold collection, 8 hours", amount: "$3,500" }],
    exclusions: ["Retainer secures your date"],
  };
  for (const trade of ["hair", "makeup", "dj"]) {
    // The draft's fields, each read alone.
    assert.deepEqual(
      importedStudioPackage({ name: "Gold", structuredContent: gold, displayOrder: 0, trade }).retainerRule,
      { type: "fixed", amountCents: 0 },
    );
    // The pasted text, read a line at a time.
    assert.deepEqual(
      importedStudioPackage({
        name: "Gold",
        structuredContent: { price: 3500 },
        displayOrder: 0,
        trade,
        sourceText: "Gold collection, 8 hours $3,500\nRetainer secures your date",
      }).retainerRule,
      { type: "fixed", amountCents: 0 },
    );
  }
});

test("a deposit the AI lists as one more line item is the deposit, never an extra", () => {
  const percent = importedStudioPackage({
    name: "Jess Styles Bridal pricing",
    structuredContent: {
      ...JESS_DRAFT,
      lineItems: [...JESS_DRAFT.lineItems, { description: "Deposit holds the date", amount: "30%" }],
    },
    displayOrder: 0,
    trade: "hair",
    sourceText: JESS_PRICE_LIST,
    addOnIdPrefix: "imported_addon_asset_jess",
  });
  // Not $100, the extensions' price on the line before it.
  assertJessPackage(percent);

  const fixed = importedStudioPackage({
    name: "Jess Styles Bridal pricing",
    structuredContent: {
      ...JESS_DRAFT,
      lineItems: [...JESS_DRAFT.lineItems, { description: "Deposit", amount: "$100" }],
    },
    displayOrder: 0,
    trade: "hair",
  });
  assert.deepEqual(fixed.retainerRule, { type: "fixed", amountCents: 10000 });
  assert.equal(fixed.addOns.length, 4);
  assert.ok(!fixed.addOns.some((addOn) => /deposit/i.test(addOn.name)));

  // A line that only mentions a deposit is not one: its price is no deposit.
  for (const lineItems of [
    [{ description: "Bridal hair, deposit required", amount: "$375" }, { description: "Trial", amount: "$150" }],
    [{ description: "Bridal hair", amount: "$375" }, "Deposit applied to the $375 total"],
  ]) {
    assert.deepEqual(
      importedStudioPackage({ name: "Bridal hair", structuredContent: { lineItems }, displayOrder: 0, trade: "hair" })
        .retainerRule,
      { type: "fixed", amountCents: 0 },
    );
  }

  // A deposit field written in words is read for its figure, not run together.
  assert.deepEqual(
    importedStudioPackage({
      name: "Bridal hair",
      structuredContent: { ...JESS_DRAFT, retainer: "30% due at booking, the rest 14 days before" },
      displayOrder: 0,
      trade: "hair",
    }).retainerRule,
    { type: "percentage", basisPoints: 3000 },
  );
});

test("guests per stylist is a ratio, not the crew", () => {
  for (const description of ["Up to 6 guests per stylist.", "Bridal hair for the bride. Up to 6 guests per stylist."]) {
    // On its own, and beside the extras (the description is kept).
    for (const lineItems of [[], JESS_DRAFT.lineItems]) {
      const hair = importedStudioPackage({
        name: "Bridal hair",
        structuredContent: { description, price: 375, lineItems },
        displayOrder: 0,
        trade: "hair",
      });
      assert.deepEqual(hair.includedCoverage, [{ role: "hair_stylist", count: 1 }]);
    }
  }
  const makeup = importedStudioPackage({
    name: "Glam",
    structuredContent: { description: "8 faces per makeup artist. Two artists on site.", price: 900, lineItems: [] },
    displayOrder: 0,
    trade: "makeup",
  });
  assert.deepEqual(makeup.includedCoverage, [{ role: "makeup_artist", count: 2 }]);
  assert.deepEqual(
    importedStudioPackage({
      name: "Glam",
      structuredContent: { description: "Six faces each artist", price: 900, lineItems: [] },
      displayOrder: 0,
      trade: "makeup",
    }).includedCoverage,
    [{ role: "makeup_artist", count: 1 }],
  );
});

test("a photographer's deposit reads its fields exactly as before, and the list's words only when it has none", () => {
  const cases: Array<[Record<string, unknown>, { type: "fixed"; amountCents: number } | { type: "percentage"; basisPoints: number }]> = [
    // No deposit field: the deposit the list states in words (onboarding
    // audit, 2026-10-24 — "A 30% retainer reserves your date" imported as $0).
    [JESS_DRAFT, { type: "percentage", basisPoints: 3000 }],
    [{ ...JESS_DRAFT, terms: "A 30% deposit holds the date." }, { type: "percentage", basisPoints: 3000 }],
    // "30%" in the retainer field has always been $30 for a photographer.
    [{ ...JESS_DRAFT, retainer: "30%" }, { type: "fixed", amountCents: 3000 }],
    // An empty or wordy retainer has always been $0, whatever comes after it.
    [{ ...JESS_DRAFT, retainer: "", retainerAmount: 500 }, { type: "fixed", amountCents: 0 }],
    [{ ...JESS_DRAFT, retainer: "TBD", retainerAmount: 500 }, { type: "fixed", amountCents: 0 }],
    [{ ...JESS_DRAFT, retainerAmount: 500 }, { type: "fixed", amountCents: 50000 }],
  ];
  for (const trade of [undefined, "photographer"]) {
    for (const [structuredContent, expected] of cases) {
      assert.deepEqual(
        importedStudioPackage({
          name: "Gold",
          structuredContent,
          displayOrder: 0,
          trade,
          sourceText: JESS_PRICE_LIST,
        }).retainerRule,
        expected,
      );
    }
    assert.deepEqual(
      importedStudioPackage({
        name: "Gold",
        structuredContent: { ...JESS_DRAFT, retainerPercent: 25 },
        displayOrder: 0,
        trade,
      }).retainerRule,
      { type: "percentage", basisPoints: 2500 },
    );
    // Its crew words read as they always have.
    assert.deepEqual(
      importedStudioPackage({
        name: "Gold",
        structuredContent: { description: "Two photographers and one videographer", price: 3500 },
        displayOrder: 0,
        trade,
      }).includedCoverage,
      [
        { role: "photographer", count: 2 },
        { role: "videographer", count: 1 },
      ],
    );
  }
});

test("more priced lines than a package keeps as extras: one package, as before, and nothing lost", () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, index) => `Service ${index + 1} $${100 + index}`);
  // Twenty extras is the most a package keeps (updatePackage's addOnIds).
  const twenty = importedStudioPackage({ name: "Menu", structuredContent: { lineItems: lines(21) }, displayOrder: 0, trade: "hair" });
  assert.equal(twenty.addOns.length, 20);
  assert.equal(twenty.basePriceCents, 10000);
  const menu = importedStudioPackage({ name: "Menu", structuredContent: { lineItems: lines(25) }, displayOrder: 0, trade: "hair" });
  assert.deepEqual(menu.addOns, []);
  assert.equal(menu.basePriceCents, 10000);
  assert.equal(menu.includedDeliverables.length, 25);
});

test("an extra keeps its unit, and its name loses the leftover", () => {
  const studioPackage = importedStudioPackage({
    name: "Bridal hair",
    structuredContent: {
      lineItems: [
        "Bridal hair $375",
        "Travel over 30 miles $1/mile",
        "Hair and makeup touch-ups $20/table",
        "Hair / veil styling $50",
      ],
    },
    displayOrder: 0,
    trade: "hair",
  });
  assert.deepEqual(
    studioPackage.addOns.map(({ name, unitPriceCents, allowQuantity, unitLabel }) => ({
      name,
      unitPriceCents,
      allowQuantity,
      unitLabel,
    })),
    [
      { name: "Travel over 30 miles", unitPriceCents: 100, allowQuantity: true, unitLabel: "mile" },
      { name: "Hair and makeup touch-ups", unitPriceCents: 2000, allowQuantity: true, unitLabel: "table" },
      // A slash in a name is part of the name.
      { name: "Hair / veil styling", unitPriceCents: 5000, allowQuantity: false, unitLabel: null },
    ],
  );
});

test("a vendor package's description is long enough to save", () => {
  const updo = importedStudioPackage({
    name: "Bridal hair",
    structuredContent: { lineItems: ["Updo $200", "Bridesmaids $90 pp"] },
    displayOrder: 0,
    trade: "hair",
  });
  assert.equal(updo.description, "Bridal hair: Updo");
  assert.deepEqual(updo.addOns.map((addOn) => [addOn.name, addOn.unitLabel]), [["Bridesmaids", "person"]]);
  const named = importedStudioPackage({
    name: "Updo",
    structuredContent: { lineItems: ["Updo $200", "Bridesmaids $90 pp"] },
    displayOrder: 0,
    trade: "hair",
  });
  assert.equal(named.description, "Updo imported from an approved studio source.");
  for (const studioPackage of [updo, named]) assert.ok(studioPackage.description.length >= 10);
});

const source = (path: string) => readFileSync(path, "utf8");

test("activation reads the studio's trade and saves the extras to the add-on library", () => {
  const review = source("functions/src/studio-import/review.ts");
  assert.match(review, /const trade = await tenantTrade\(db, input\.tenantId\);/);
  // The first activation, "Sync to library", and setup's price review
  // (packagePreviews), which must show what activation writes (2026-10-24).
  assert.equal(review.match(/importedStudioPackage\(\{[^}]*\btrade,/g)?.length, 3);
  assert.equal(review.match(/batch\.set\(\s*db\.doc\(`addOns\/\$\{addOn\.id\}`\)/g)?.length, 1);
  assert.equal(review.match(/transaction\.set\(\s*db\.doc\(`addOns\/\$\{addOn\.id\}`\)/g)?.length, 1);
  // "Sync to library" never rewrites an extra the studio has since edited,
  // and never brings back one it archived.
  assert.match(review, /if \(libraryAddOns\.get\(addOn\.id\)\?\.exists\) continue;/);
  assert.match(review, /!library\.get\("archivedAt"\)\s*\? \[libraryAddOnCopy\(library\)\]\s*: \[\]/);
});

test("the AI is never handed zero hours as a package's coverage", () => {
  assert.equal(statedCoverageMinutes(0), null);
  assert.equal(statedCoverageMinutes(undefined), null);
  assert.equal(statedCoverageMinutes(480), 480);
  assert.match(source("functions/src/ai/copilot.ts"), /includedCoverageMinutes: statedCoverageMinutes\(primary\.get\("includedCoverageMinutes"\)\)/);
  assert.match(source("functions/src/ai/copilot.ts"), /includedCoverageMinutes: statedCoverageMinutes\(data\.includedCoverageMinutes\)/);
  assert.match(source("functions/src/ai/message-draft.ts"), /includedCoverageMinutes: statedCoverageMinutes\(item\.get\("includedCoverageMinutes"\)\)/);
  assert.match(source("functions/src/operations/ai-pdf.ts"), /includedCoverageMinutes:statedCoverageMinutes\(document\.get\("includedCoverageMinutes"\)\)/);
});

test("Approve carries a name typed but not saved", () => {
  const selected = {
    id: "version_1",
    name: "Pasted Price List",
    assetType: "package",
    structuredContent: JESS_DRAFT as Record<string, unknown>,
  };
  // Jess renamed the draft and clicked Approve.
  assert.deepEqual(
    approvalEdits({ action: "approve", versionId: "version_1", selected, name: "Bridal hair ", content: selected.structuredContent }),
    { name: "Bridal hair", assetType: "package", structuredContent: JESS_DRAFT },
  );
  // An edited field goes too; a blank name keeps the draft's.
  const content = { ...JESS_DRAFT, currency: "CAD" };
  assert.deepEqual(
    approvalEdits({ action: "approve", versionId: "version_1", selected, name: "  ", content }),
    { name: "Pasted Price List", assetType: "package", structuredContent: content },
  );
  // Nothing changed, a rejection, or another draft: no edits.
  assert.equal(
    approvalEdits({ action: "approve", versionId: "version_1", selected, name: selected.name, content: { ...JESS_DRAFT } }),
    null,
  );
  assert.equal(approvalEdits({ action: "reject", versionId: "version_1", selected, name: "Bridal hair", content }), null);
  assert.equal(approvalEdits({ action: "approve", versionId: "version_2", selected, name: "Bridal hair", content }), null);

  const workspace = source("components/ai/studio-import-review-workspace.tsx");
  assert.match(workspace, /const edits = approvalEdits\(\{ action, versionId, selected, name, content \}\);/);
  assert.match(workspace, /\.\.\.\(edits \?\? \{\}\),/);
});

test("the activation banner says only what was activated", () => {
  const approved = (assetType: string) => ({ assetType, reviewDecision: "approved" });
  // Jess's one price list.
  assert.equal(activationSummary([approved("package")]), "1 package is in your library.");
  assert.equal(
    activationSummary([
      approved("package"),
      approved("package"),
      approved("questionnaire"),
      approved("message_template"),
      approved("delivery_instruction"),
      approved("workflow"),
      { assetType: "timing_rule", reviewDecision: "rejected" },
    ]),
    "2 packages are in your library. 1 form is ready to send. 1 message is ready to turn on. Delivery instructions are saved as your defaults. 1 more item is saved to your library.",
  );
  assert.equal(activationSummary([{ assetType: "package", reviewDecision: "pending" }]), "");

  const workspace = source("components/ai/studio-import-review-workspace.tsx");
  assert.match(workspace, /const activated = activationSummary\(visibleDrafts\);/);
  assert.doesNotMatch(workspace, /timing rules are active\. Imported messages/);
});

test("setup's paste box asks for a price list, not an email", () => {
  const studio = source("components/ai/template-import-studio.tsx");
  assert.match(studio, /label: "Paste your price list"/);
  assert.match(studio, /\{kindCopy\?\.label \?\? "Paste the full message"\}/);
  assert.match(studio, /kindCopy\.placeholder\(depositWord\)/);
});
