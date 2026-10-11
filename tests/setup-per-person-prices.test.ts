import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasPerPersonPrice, isPerPersonAddOn } from "@/features/packages/per-person-price";
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
const pkg = (addOns: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Bridal hair",
  active: true,
  addOns,
  ...extra,
});

test("a per-person add-on counts quantity priced per person, or with no unit", () => {
  assert.equal(isPerPersonAddOn(bridesmaidHair), true);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: " People " }), true);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: "guest" }), true);
  // Saved from a job's own line: a quantity, no unit — "4 × $120".
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: null }), true);
  // Priced per something else, or a single extra.
  assert.equal(isPerPersonAddOn(touchUpStay), false);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, unitLabel: "artist" }), false);
  assert.equal(isPerPersonAddOn(veil), false);
  // Not offered any more.
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, archivedAt: "2026-10-01T00:00:00.000Z" }), false);
  assert.equal(isPerPersonAddOn({ ...bridesmaidHair, active: false }), false);
  assert.equal(isPerPersonAddOn(null), false);
  assert.equal(isPerPersonAddOn("Bridesmaid hair"), false);
});

test("every per-person example a hair stylist starts from counts", () => {
  for (const idea of extraIdeasFor("hair")) {
    const addOn = { allowQuantity: idea.perUnit !== null, unitLabel: idea.perUnit ?? "" };
    assert.equal(isPerPersonAddOn(addOn), idea.perUnit === "person", idea.name);
  }
});

test("one imported package with no per-person extras still asks for them", () => {
  // Jess Styles Bridal's state after the import: one package, nothing per person.
  assert.equal(hasPerPersonPrice({ addOns: [], packages: [pkg([])] }), false);
  assert.equal(hasPerPersonPrice({ addOns: [touchUpStay, veil], packages: [pkg([touchUpStay])] }), false);
  assert.equal(hasPerPersonPrice({ addOns: [], packages: [] }), false);
});

test("a per-person price in the library or on a package answers it", () => {
  assert.equal(hasPerPersonPrice({ addOns: [bridesmaidHair], packages: [] }), true);
  // Archived in the library but still offered on a package.
  assert.equal(
    hasPerPersonPrice({
      addOns: [{ ...bridesmaidHair, archivedAt: "2026-10-01T00:00:00.000Z" }],
      packages: [pkg([{ ...bridesmaidHair, active: true }])],
    }),
    true,
  );
  // An inactive package, or one couple's one-off, is not her price list.
  assert.equal(hasPerPersonPrice({ addOns: [], packages: [pkg([bridesmaidHair], { active: false })] }), false);
  assert.equal(
    hasPerPersonPrice({ addOns: [], packages: [pkg([bridesmaidHair], { oneOff: { projectId: "job-1" } })] }),
    false,
  );
});

test("setup's answered prices row keeps the link for a per-person trade only", () => {
  const conversation = read("components/setup/setup-conversation.tsx");
  // Only her trade reads the add-ons; a photographer's page reads nothing new.
  assert.match(conversation, /const perPersonPricing = tradeProfile\(workspace\.tenantTrade\)\.perPersonPricing;/);
  assert.match(conversation, /useTenantDocuments\("addOns", \{ enabled: perPersonPricing \}\)/);
  assert.match(conversation, /hasPerPersonPrice\(\{ addOns: addOnRecords, packages: packageRecords \}\)/);
  // The answered row: asks until one exists, then a quiet link.
  assert.match(conversation, /if \(question\.key === "packages" && perPersonPricing\) \{/);
  assert.match(
    conversation,
    /<Link className="button button-light button-sm" href=\{PER_PERSON_PRICES\}>\s*Set per-person prices <ArrowRight size=\{14\} \/>/,
  );
  assert.match(conversation, /<Link className="setup-answer-link" href=\{PER_PERSON_PRICES\}>\s*Per-person prices\s*<\/Link>/);
  // The unanswered row still offers it beside the import.
  assert.match(conversation, /tradeProfile\(workspace\.tenantTrade\)\.perPersonPricing \? \(\s*<Link className="setup-answer-link" href=\{PER_PERSON_PRICES\}>\s*Set per-person prices/);
  // Done and the count are untouched: still any question with no gap.
  assert.match(conversation, /const answered = ordered\.filter\(\(question\) => !gapByKey\.has\(question\.key\)\)\.length;/);
  assert.match(conversation, /const done = !gap;/);
});
