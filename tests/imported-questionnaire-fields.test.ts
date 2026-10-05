import assert from "node:assert/strict";
import test from "node:test";
import {
  importedFieldType,
  importedQuestionnaireSections,
} from "../functions/src/studio-import/review.ts";

test("a one-option choice from an import is asked as text (Gabe, 2026-10-05)", () => {
  // GR's "# of Invited Guests" came back as a dropdown whose one option was
  // the sample answer "100-150".
  const [section] = importedQuestionnaireSections({
    fields: [
      { id: "of-invited-guests", label: "# of Invited Guests", type: "choice", options: ["100-150"], required: true },
      { id: "package", label: "Package", type: "choice", options: ["Gold", "Silver"] },
      { id: "first-look", label: "First look?", type: "radio", options: [] },
    ],
  });
  const fields = section!.fields;
  assert.deepEqual(
    fields.map((field) => [field.id, field.type, field.options]),
    [
      ["of-invited-guests", "text", []],
      ["package", "dropdown", ["Gold", "Silver"]],
      ["first-look", "text", []],
    ],
  );
});

test("real choices, checkboxes and other types pass through", () => {
  assert.equal(importedFieldType("multi_select", ["A", "B"]), "multi_select");
  assert.equal(importedFieldType("multi_select", ["A"]), "text");
  assert.equal(importedFieldType("checkbox", []), "checkbox", "a lone checkbox is a real yes/no");
  assert.equal(importedFieldType("short_text", []), "text");
  assert.equal(importedFieldType("date", []), "date");
  assert.equal(importedFieldType("something-new", []), "text");
});
