import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasPerPersonPrice, isPerPersonAddOn, perPersonPricesLink } from "@/features/packages/per-person-price";
import { extraIdeasFor } from "@/features/packages/extra-ideas";

/**
 * Setup keeps per-person prices reachable (hair walk, F29, 2026-10-10).
 *
 * "What do you charge?" ticks Done as soon as any package exists, and its
 * "Set per-person prices" link lived only in the unanswered state. Jess Styles
 * Bridal imported one package and was never asked about her bridesmaids
 * again. Now a makeup artist's or hair stylist's answered row keeps asking
 * until a per-person price exists, then keeps a quieter link. The count, the
 * gaps and a photographer's page do not move.
 */

const read = (path: string) => readFileSync(path, "utf8");

const bridesmaidHair = { id: "a1", name: "Bridesmaid hair", allowQuantity: true, unitLabel: "person", archivedAt: null };
const touchUpStay = { id: "a2", name: "Touch-up stay", allowQuantity: true, unitLabel: "hour", archivedAt: null };
const veil = { id: "a3", name: "Veil placement", allowQuantity: false, unitLabel: null, archivedAt: null };
// What saveToLibrary writes for a job's own line with a quantity above one:
// allowQuantity, and no unit at all (functions/src/crm/commands.ts).
const savedFromJob = (name: string) => ({ id: `job-${name}`, name, allowQuantity: true, archivedAt: null });
const pkg = (addOns: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Bridal hair",
  active: true,
  addOns,
  ...extra,
});
const loaded = (records: unknown[]) => ({ records, error: null });

test("a per-person add-on counts quantity priced per person", () => {
  assert.equal(isPerPersonAddOn(bridesmaidHair, "hair"), true);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: " People " }, "hair"), true);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: "guest" }, "hair"), true);
  // Priced per something else, or a single extra.
  assert.equal(isPerPersonAddOn(touchUpStay, "hair"), false);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: "artist" }, "hair"), false);
  assert.equal(isPerPersonAddOn(veil, "hair"), false);
  // Not offered any more.
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, archivedAt: "2026-10-01T00:00:00.000Z" }, "hair"), false);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, active: false }, "hair"), false);
  assert.equal(isPerPersonAddOn(null, "hair"), false);
  assert.equal(isPerPersonAddOn("Bridesmaid hair", "hair"), false);
});

test("no unit counts only under one of the trade's per-person names", () => {
  // Saved from a job with a quantity: an hour or travel is not a person.
  assert.equal(isPerPersonAddOn(savedFromJob("Extra hour"), "hair"), false);
  assert.equal(isPerPersonAddOn(savedFromJob("Travel"), "hair"), false);
  assert.equal(isPerPersonAddOn(savedFromJob("Touch-up stay"), "hair"), false);
  assert.equal(isPerPersonAddOn({ ...savedFromJob("Bridesmaid styling"), unitLabel: null }, "hair"), false);
  // Her bridesmaids, saved the same way, still are.
  assert.equal(isPerPersonAddOn(savedFromJob("Bridesmaid hair"), "hair"), true);
  assert.equal(isPerPersonAddOn(savedFromJob("  bridesmaid   HAIR "), "hair"), true);
  assert.equal(isPerPersonAddOn({ ...savedFromJob("Bridesmaid makeup"), unitLabel: "" }, "makeup"), true);
  // Another trade's name is not hers.
  assert.equal(isPerPersonAddOn(savedFromJob("Bridesmaid makeup"), "hair"), false);
  // Neither is a single extra under the right name.
  assert.equal(isPerPersonAddOn({ ...savedFromJob("Bridesmaid hair"), allowQuantity: false }, "hair"), false);
  // Jess Styles Bridal saving "Extra hour" ×2 from a job keeps the ask.
  assert.equal(hasPerPersonPrice({ addOns: [savedFromJob("Extra hour"), savedFromJob("Travel")], packages: [pkg([])], trade: "hair" }), false);
});

test("every per-person example a makeup artist or hair stylist starts from counts", () => {
  for (const trade of ["hair", "makeup"] as const) {
    for (const idea of extraIdeasFor(trade)) {
      const started = { name: idea.name, allowQuantity: idea.perUnit !== null, unitLabel: idea.perUnit ?? "" };
      assert.equal(isPerPersonAddOn(started, trade), idea.perUnit === "person", `${trade}: ${idea.name}`);
      // The same idea saved from a job, unit lost.
      const saved = { name: idea.name, allowQuantity: true };
      assert.equal(isPerPersonAddOn(saved, trade), idea.perUnit === "person", `${trade}, saved: ${idea.name}`);
    }
  }
});

test("one imported package with no per-person extras still asks for them", () => {
  // Jess Styles Bridal's state after the import: one package, nothing per person.
  assert.equal(hasPerPersonPrice({ addOns: [], packages: [pkg([])], trade: "hair" }), false);
  assert.equal(
    hasPerPersonPrice({ addOns: [touchUpStay, veil], packages: [pkg([touchUpStay])], trade: "hair" }),
    false,
  );
  assert.equal(hasPerPersonPrice({ addOns: [], packages: [], trade: "hair" }), false);
});

test("a per-person price in the library or on a package answers it", () => {
  assert.equal(hasPerPersonPrice({ addOns: [bridesmaidHair], packages: [], trade: "hair" }), true);
  // Archived in the library but still offered on a package.
  assert.equal(
    hasPerPersonPrice({
      addOns: [{ ...bridesmaidHair, archivedAt: "2026-10-01T00:00:00.000Z" }],
      packages: [pkg([{ ...bridesmaidHair, active: true }])],
      trade: "hair",
    }),
    true,
  );
  // An inactive package, or one couple's one-off, is not her price list.
  assert.equal(
    hasPerPersonPrice({ addOns: [], packages: [pkg([bridesmaidHair], { active: false })], trade: "hair" }),
    false,
  );
  assert.equal(
    hasPerPersonPrice({
      addOns: [],
      packages: [pkg([bridesmaidHair], { oneOff: { projectId: "job-1" } })],
      trade: "hair",
    }),
    false,
  );
});

test("the answered row asks, then goes quiet, for a per-person trade only", () => {
  // Jess Styles Bridal after the import: asked.
  assert.equal(perPersonPricesLink({ trade: "hair", addOns: loaded([]), packages: loaded([pkg([])]) }), "ask");
  assert.equal(perPersonPricesLink({ trade: "makeup", addOns: loaded([]), packages: loaded([pkg([])]) }), "ask");
  // Once one is priced: the quieter link.
  assert.equal(
    perPersonPricesLink({ trade: "hair", addOns: loaded([bridesmaidHair]), packages: loaded([pkg([])]) }),
    "quiet",
  );
  // Still loading: nothing yet, rather than a button that turns into a link.
  assert.equal(perPersonPricesLink({ trade: "hair", addOns: { records: null, error: null }, packages: loaded([]) }), null);
  assert.equal(perPersonPricesLink({ trade: "hair", addOns: loaded([]), packages: { records: null, error: null } }), null);
  // A read that failed is not "none priced": the link stays, quietly.
  assert.equal(
    perPersonPricesLink({ trade: "hair", addOns: { records: [], error: "Missing or insufficient permissions." }, packages: loaded([]) }),
    "quiet",
  );
  assert.equal(
    perPersonPricesLink({ trade: "hair", addOns: loaded([]), packages: { records: [], error: "unavailable" } }),
    "quiet",
  );
  // A photographer's and a DJ's page do not move, whatever the library holds.
  for (const trade of [undefined, "photographer", "dj"]) {
    assert.equal(perPersonPricesLink({ trade, addOns: loaded([]), packages: loaded([pkg([])]) }), null, String(trade));
    assert.equal(perPersonPricesLink({ trade, addOns: loaded([bridesmaidHair]), packages: loaded([]) }), null, String(trade));
  }
});

test("setup's answered prices row keeps the link for a per-person trade only", () => {
  const conversation = read("components/setup/setup-conversation.tsx");
  // Only her trade reads the add-ons; a photographer's page reads nothing new.
  assert.match(conversation, /const perPersonPricing = tradeProfile\(workspace\.tenantTrade\)\.perPersonPricing;/);
  assert.match(conversation, /useTenantDocuments\("addOns", \{ enabled: perPersonPricing \}\)/);
  assert.match(conversation, /useTenantDocuments\("packages", \{ enabled: perPersonPricing \}\)/);
  assert.match(
    conversation,
    /perPersonPricesLink\(\{\s*trade: workspace\.tenantTrade,\s*addOns: addOnRead,\s*packages: packageRead,\s*\}\)/,
  );
  // The answered row: asks until one exists, then a quiet link.
  assert.match(conversation, /if \(question\.key === "packages" && perPersonLink\) \{/);
  assert.match(conversation, /\{perPersonLink === "quiet" \? \(\s*<Link className="setup-answer-link" href=\{PER_PERSON_PRICES\}>\s*Per-person prices\s*<\/Link>/);
  assert.match(
    conversation,
    /<Link className="button button-light button-sm" href=\{PER_PERSON_PRICES\}>\s*Set per-person prices <ArrowRight size=\{14\} \/>/,
  );
  // The unanswered row still offers it beside the import.
  assert.match(conversation, /tradeProfile\(workspace\.tenantTrade\)\.perPersonPricing \? \(\s*<Link className="setup-answer-link" href=\{PER_PERSON_PRICES\}>\s*Set per-person prices/);
  // Done and the count are untouched: still any question with no gap.
  assert.match(conversation, /const answered = ordered\.filter\(\(question\) => !gapByKey\.has\(question\.key\)\)\.length;/);
  assert.match(conversation, /const done = !gap;/);
});
