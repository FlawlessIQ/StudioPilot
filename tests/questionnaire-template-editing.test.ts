import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { repairTemplateLinks, templateLinkProblems } from "@/features/questionnaires/template-rules";
import {
  moveField,
  moveFieldToSection,
  moveSection,
  newSectionId,
  questionDestinations,
  removeSection,
} from "@/features/questionnaires/template-editing";
import { recommendedQuestionnaires } from "@/features/questionnaires/recommended-templates";
import { starterQuestionnaires } from "@/features/questionnaires/starter-templates";

/**
 * A studio can now reorder questions, add and rename sections, and set "show
 * only when" and suggested times (2026-10-02). The links between questions
 * must point at earlier ones; a move that breaks one is repaired and said.
 */

type F = { id: string; type: string; conditionalOn?: { fieldId: string; equals: unknown } | null; suggestedFrom?: { fieldId: string; minutes: number } | null };
const q = (id: string, type = "text", extra: Partial<F> = {}): F => ({ id, type, conditionalOn: null, ...extra });
const form = () => [
  { id: "a", title: "A", fields: [q("first-look", "radio"), q("ceremony", "time"), q("hide", "time", { suggestedFrom: { fieldId: "ceremony", minutes: -30 } })] },
  { id: "b", title: "B", fields: [q("first-look-time", "time", { conditionalOn: { fieldId: "first-look", equals: "Yes" } }), q("notes")] },
];
const ids = (sections: ReturnType<typeof form>) => sections.map((section) => section.fields.map((field) => field.id));

test("the functions copy of the rules is identical, below its header", () => {
  const body = (path: string) => readFileSync(path, "utf8").replace(/\/\*\*[\s\S]*?\*\/\n/, "");
  assert.equal(body("functions/src/planning/template-rules.ts"), body("features/questionnaires/template-rules.ts"));
});

test("every shipped form holds together", () => {
  for (const template of [...recommendedQuestionnaires(), ...starterQuestionnaires()])
    assert.deepEqual(templateLinkProblems(template.sections), [], template.name);
  assert.deepEqual(templateLinkProblems(form()), []);
});

test("links must point at an earlier question; a suggestion runs time to time", () => {
  const broken = [
    { id: "s", title: "", fields: [q("x", "time", { suggestedFrom: { fieldId: "y", minutes: 10 } }), q("y", "time"), q("z", "text", { suggestedFrom: { fieldId: "y", minutes: 0 } })] },
    { id: "t", title: "", fields: [q("w", "text", { conditionalOn: { fieldId: "gone", equals: "Yes" } }), q("y")] },
  ];
  assert.deepEqual(templateLinkProblems(broken), [
    { fieldId: "x", kind: "suggestion" },
    { fieldId: "z", kind: "suggestion" },
    { fieldId: "w", kind: "condition" },
    { fieldId: "y", kind: "duplicate" },
  ]);
  assert.equal(templateLinkProblems([{ fields: [q("t", "time", { suggestedFrom: { fieldId: "t0", minutes: 900 } })] }]).length, 1);
});

test("arrows move a question, crossing into the next section at the edge", () => {
  assert.deepEqual(ids(moveField(form(), "ceremony", -1)), [["ceremony", "first-look", "hide"], ["first-look-time", "notes"]]);
  assert.deepEqual(ids(moveField(form(), "hide", 1)), [["first-look", "ceremony"], ["hide", "first-look-time", "notes"]]);
  assert.deepEqual(ids(moveField(form(), "first-look-time", -1)), [["first-look", "ceremony", "hide", "first-look-time"], ["notes"]]);
  assert.deepEqual(ids(moveField(form(), "first-look", -1)), ids(form()), "the first question stays first");
  assert.deepEqual(ids(moveFieldToSection(form(), "first-look", "b")), [["ceremony", "hide"], ["first-look-time", "notes", "first-look"]]);
});

test("a move that breaks a rule clears it, and says which", () => {
  // The first-look question below the time that waits on it.
  const moved = moveFieldToSection(form(), "first-look", "b");
  const repaired = repairTemplateLinks(moved);
  assert.deepEqual(repaired.cleared, [{ fieldId: "first-look-time", kind: "condition" }]);
  assert.equal(repaired.sections[1]!.fields[0]!.conditionalOn, null);
  // The ceremony moved below the hide time it feeds.
  const below = repairTemplateLinks(moveField(form(), "ceremony", 1));
  assert.deepEqual(below.cleared, [{ fieldId: "hide", kind: "suggestion" }]);
  assert.equal("suggestedFrom" in below.sections[0]!.fields[1]!, false);
  // Nothing broken, nothing touched.
  assert.deepEqual(repairTemplateLinks(form()).cleared, []);
});

test("sections move, and go with or without their questions — never the last one", () => {
  assert.deepEqual(moveSection(form(), "b", -1).map((section) => section.id), ["b", "a"]);
  assert.deepEqual(ids(removeSection(form(), "b", "a")), [["first-look", "ceremony", "hide", "first-look-time", "notes"]]);
  assert.deepEqual(ids(removeSection(form(), "b", null)), [["first-look", "ceremony", "hide"]]);
  assert.equal(removeSection([form()[0]!], "a", null).length, 1);
  assert.equal(newSectionId([{ id: "section-1" }, { id: "section-3" }]), "section-4");
  assert.equal(newSectionId([{ id: "section-1" }, { id: "section-2" }]), "section-3");
});

test("the editor says where an answer goes, from the wording", () => {
  assert.deepEqual(questionDestinations({ label: "Ceremony location", type: "address" }), ["contract", "locks"]);
  assert.deepEqual(questionDestinations({ label: "Number of invited guests", type: "text" }), ["contract"]);
  assert.deepEqual(questionDestinations({ label: "Ceremony notes", type: "long_text" }), []);
  assert.deepEqual(questionDestinations({ label: "Ceremony location", type: "address", internalOnly: true }), []);
  assert.deepEqual(questionDestinations({ label: "", type: "text" }), []);
});

test("wired: the server refuses a broken template, and the error reads", () => {
  const commands = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.equal(commands.match(/templateLinkProblems\(parsed\.input\.sections\)\.length/g)?.length, 2);
  assert.match(readFileSync("lib/ai/friendly-error.ts", "utf8"), /QUESTIONNAIRE_TEMPLATE_INVALID:/);
  // "Build template" opens the same editor, empty.
  assert.match(readFileSync("components/planning/questionnaire-builder.tsx", "utf8"), /<QuestionnaireTemplateEditor mode="create" \/>/);
});
