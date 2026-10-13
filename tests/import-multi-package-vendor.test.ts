import assert from "node:assert/strict";
import test from "node:test";
import { importedStudioPackage, packageSection, planningScopeFromName, sharedExtras } from "../functions/src/studio-import/native-assets";

// Bloom Events' list, as pasted in UAT 2026-10-13: three packages, one Extras section.
const LIST = `Bloom Events — 2027 wedding planning

Full Planning — $6,500
From engagement to the last dance: vendor sourcing and booking, budget tracking, design, monthly planning meetings, venue walkthrough, rehearsal and full wedding-day coordination with an assistant (up to 12 hours).

Partial Planning — $4,200
Starting 6 months out: vendor recommendations, design guidance, timeline, venue walkthrough, rehearsal and wedding-day coordination (up to 10 hours).

Month-Of Coordination — $2,400
Starting 6 weeks out: vendor confirmations, timeline, final walkthrough, rehearsal and wedding-day coordination (up to 10 hours).

Extras
Additional day-of assistant — $450
Welcome party coordination — $850
Extra hour on the day — $200 per hour

30% deposit to book.`;

test("one package of a vendor's several keeps its own paragraph, hours, the shared extras and a planner's tier", () => {
  assert.match(packageSection(LIST, "Full Planning"), /^From engagement to the last dance/);
  assert.doesNotMatch(packageSection(LIST, "Full Planning"), /Partial Planning/);
  assert.deepEqual(
    sharedExtras(LIST).map((extra) => [extra.name, extra.cents, extra.unit]),
    [
      ["Additional day-of assistant", 45000, null],
      ["Welcome party coordination", 85000, null],
      ["Extra hour on the day", 20000, "hour"],
    ],
  );
  assert.equal(planningScopeFromName("Month-Of Coordination"), "coordination");
  assert.equal(planningScopeFromName("Partial Planning"), "partial");
  assert.equal(planningScopeFromName("Full Planning"), "full");
  assert.equal(planningScopeFromName("Elopement"), null);

  // What the AI drafted: the name and the price, nothing else.
  const pkg = importedStudioPackage({
    name: "Full Planning",
    structuredContent: { description: "Full Planning 6,500", lineItems: [{ name: "Full Planning", price: 6500, currency: "USD" }], retainerPercent: 30 },
    displayOrder: 0,
    trade: "planner",
    sourceText: LIST,
  }) as Record<string, unknown>;
  assert.match(String(pkg.description), /^From engagement to the last dance/);
  assert.equal(pkg.includedCoverageMinutes, 720);
  assert.equal((pkg.addOns as unknown[]).length, 3);
  assert.equal(pkg.planningScope, "full");
  assert.equal(pkg.basePriceCents, 650000);

  // A photographer's list reads as it always did: no tier, no shared-extras parse.
  const photo = importedStudioPackage({
    name: "Full Planning",
    structuredContent: { description: "Full Planning 6,500", lineItems: [{ name: "Full Planning", price: 6500 }] },
    displayOrder: 0,
    sourceText: LIST,
  }) as Record<string, unknown>;
  assert.equal(photo.planningScope, undefined);
  assert.equal((photo.addOns as unknown[]).length, 0);
});

test("a planner's agreement preview is a planner's, not a photographer's", async () => {
  const { sampleContractSources } = await import("../features/contracts/sample");
  const words = JSON.stringify(sampleContractSources("Bloom Events", "2026-10-13", "planner"));
  assert.doesNotMatch(words, /photographer|gallery|album/i);
  assert.match(words, /coordinator/);
});

test("a list's shared extras are one library entry each, whichever package carries them", () => {
  // UAT 2026-10-13: each extra appeared three times in the picker, once per tier.
  const ids = ["Full Planning", "Partial Planning"].map((name, index) =>
    (
      importedStudioPackage({
        name,
        structuredContent: { lineItems: [{ name, price: index ? 4200 : 6500 }] },
        displayOrder: index,
        trade: "planner",
        sourceText: LIST,
        addOnIdPrefix: `imported_addon_asset${index}`,
        sharedAddOnIdPrefix: "imported_addon_session1",
      }).addOns as Array<{ id: string }>
    ).map((addOn) => addOn.id),
  );
  assert.deepEqual(ids[0], ids[1]);
  assert.ok(ids[0]!.every((id) => id.startsWith("imported_addon_session1_")));
});
