import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  familyTone,
  kindAliases,
  kindFamily,
  kindTone,
  toneForValue,
  type KindFamily,
  type KindTone,
  type LibraryKind,
} from "@/features/library/kinds";

/**
 * Every noun the app can render a glyph for. Kept as a literal list rather
 * than derived from the module, so adding a kind without deciding what it
 * means fails here instead of shipping a colourless tile.
 */
const allKinds: LibraryKind[] = [
  "contract",
  "proposal",
  "package",
  "invoice",
  "document",
  "insurance",
  "questionnaire",
  "form",
  "schedule",
  "crew",
  "calendar",
  "event",
  "venue",
  "message",
  "email",
  "review",
  "delivery",
  "workflow",
  "automation",
  "task",
];

const allFamilies: KindFamily[] = [
  "agreement",
  "client_input",
  "logistics",
  "outbound",
  "automation",
];

test("every kind resolves to a family and a tone", () => {
  for (const kind of allKinds) {
    const family = kindFamily(kind);
    assert.ok(
      allFamilies.includes(family),
      `${kind} has no family — decide what it is before shipping a glyph for it`,
    );
    assert.ok(kindTone(kind), `${kind} has no tone`);
  }
});

test("every tone the module can produce has a CSS rule", () => {
  // The tone classes and the map are in different files and different
  // languages; nothing but this test keeps them in step.
  const css = readFileSync("app/studiocue-reimagined.css", "utf8");
  for (const tone of Object.values(familyTone)) {
    assert.match(
      css,
      new RegExp(`\\.tone-${tone}\\s*\\{`),
      `.tone-${tone} is referenced by the kind map but not defined in CSS`,
    );
  }
  assert.match(css, /\.kind-glyph\s*\{/);
});

test("mint is never a kind tone", () => {
  // --cue-mint sits one degree from the live primary accent, so a mint
  // tile reads as a primary action. Mint stays a state colour: approved,
  // verified, nothing pending.
  const tones: KindTone[] = Object.values(familyTone);
  assert.ok(!tones.includes("mint" as KindTone));
  assert.equal(new Set(tones).size, tones.length, "two families share a hue");
});

test("the families group the way a photographer thinks", () => {
  // Money and promises are one thing to a studio owner, whatever the
  // schema calls them.
  for (const kind of ["contract", "proposal", "package", "invoice"] as const)
    assert.equal(kindTone(kind), "violet", kind);
  assert.equal(kindTone("questionnaire"), "gold");
  for (const kind of ["schedule", "crew", "calendar"] as const)
    assert.equal(kindTone(kind), "blue", kind);
  // The gallery is the whole point of the job, and it leaves the studio.
  for (const kind of ["message", "review", "delivery"] as const)
    assert.equal(kindTone(kind), "coral", kind);
  assert.equal(kindTone("workflow"), "rose");
});

test("foreign vocabularies resolve through the alias table", () => {
  // Import asset types.
  assert.equal(toneForValue("message_template"), "coral");
  assert.equal(toneForValue("coi_instruction"), "violet");
  assert.equal(toneForValue("timing_rule"), "blue");
  // Journey step keys.
  assert.equal(toneForValue("run_of_show"), "blue");
  assert.equal(toneForValue("final_balance"), "violet");
  assert.equal(toneForValue("schedule_form"), "gold");
  // Case and padding are not the caller's problem.
  assert.equal(toneForValue("  Contract  "), "violet");
});

test("an unknown value gets no colour rather than a wrong one", () => {
  assert.equal(toneForValue("wedding_vibe"), null);
  assert.equal(toneForValue(""), null);
  assert.equal(toneForValue(null), null);
  assert.equal(toneForValue(undefined), null);
});

test("every alias points at a real kind", () => {
  for (const [alias, kind] of Object.entries(kindAliases)) {
    assert.ok(
      allKinds.includes(kind),
      `alias "${alias}" points at "${kind}", which is not a kind`,
    );
  }
});
