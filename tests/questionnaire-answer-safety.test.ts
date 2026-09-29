import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mergeQuestionnaireAnswers,
  questionnaireFieldRules,
} from "../functions/src/planning/questionnaire-answers";
import {
  parseQuestionnaireSections,
  visibleQuestionnaireSections,
} from "../features/questionnaires/client-form";

/**
 * A couple's save used to replace the whole answer map with the fields their
 * form was showing, deleting the studio's internal-only answers and any answer
 * behind a condition they had flipped. And the autosave that fired after
 * Submit set the status back to in progress.
 */

const template = {
  sections: [
    {
      id: "day",
      title: "The day",
      fields: [
        { id: "ceremonyTime", label: "Ceremony", type: "time", required: true },
        { id: "helper", label: "Helper?", type: "radio", options: ["Yes", "No"] },
        { id: "helperName", label: "Helper name", type: "text", conditionalOn: { fieldId: "helper", equals: "Yes" } },
        { id: "studioNotes", label: "Studio notes", type: "long_text", internalOnly: true },
        { id: "package", label: "Package", type: "text", locked: true },
      ],
    },
    { id: "empty", title: "Studio only", fields: [{ id: "cost", label: "Cost", type: "text", internalOnly: true }] },
  ],
};

test("a save changes what it sends and keeps everything it does not mention", () => {
  const merged = mergeQuestionnaireAnswers({
    prior: { ceremonyTime: "16:00", helperName: "Aunt Rosa", studioNotes: "85mm" },
    incoming: { ceremonyTime: "16:30", helper: "No" },
    rules: questionnaireFieldRules(template),
    byClient: true,
  });
  assert.deepEqual(merged, {
    ceremonyTime: "16:30",
    helper: "No",
    helperName: "Aunt Rosa",
    studioNotes: "85mm",
  });
});

test("a couple cannot write the studio's internal-only or locked answers", () => {
  const merged = mergeQuestionnaireAnswers({
    prior: { studioNotes: "85mm", package: "Signature" },
    incoming: { studioNotes: "", package: "Everything" },
    rules: questionnaireFieldRules(template),
    byClient: true,
  });
  assert.deepEqual(merged, { studioNotes: "85mm", package: "Signature" });
});

test("the studio can write internal-only and locked answers", () => {
  const merged = mergeQuestionnaireAnswers({
    prior: { studioNotes: "85mm" },
    incoming: { studioNotes: "70-200 too", package: "Signature" },
    rules: questionnaireFieldRules(template),
    byClient: false,
  });
  assert.deepEqual(merged, { studioNotes: "70-200 too", package: "Signature" });
});

test("the command saves the merge, and refuses a couple's save after submit", () => {
  const source = readFileSync("functions/src/planning/commands.ts", "utf8");
  const save = source.slice(source.indexOf('parsed.type === "saveQuestionnaire"'));
  assert.match(save, /answers: nextAnswers,/);
  assert.doesNotMatch(save.slice(0, 4000), /answers: parsed\.input\.answers/);
  assert.match(save, /QUESTIONNAIRE_ALREADY_SUBMITTED/);
});

test("the couple's form sends every answer it holds, not only the visible ones", () => {
  const source = readFileSync("components/client/kit/client-questionnaire.tsx", "utf8");
  assert.match(source, /const payload = \{ \.\.\.answersRef\.current \};/);
  assert.doesNotMatch(source, /visibleAnswers/);
  // Disabling inputs during autosave dropped the phone keyboard mid-word.
  const inputs = source.slice(source.indexOf("function Question("));
  assert.doesNotMatch(inputs, /saving/);
});

test("the couple sees no internal questions, conditional ones only when they apply, and no empty section", () => {
  const sections = parseQuestionnaireSections(template.sections);
  const hidden = visibleQuestionnaireSections(sections, { helper: "No" });
  assert.deepEqual(
    hidden.map((section) => section.fields.map((field) => field.id)),
    [["ceremonyTime", "helper", "package"]],
  );
  const shown = visibleQuestionnaireSections(sections, { helper: "Yes" });
  assert.deepEqual(shown[0]!.fields.map((field) => field.id), ["ceremonyTime", "helper", "helperName", "package"]);
});

test("a response with no template snapshot falls back to the legacy questions", () => {
  const sections = parseQuestionnaireSections(undefined);
  assert.equal(sections[0]!.fields.some((field) => field.id === "familyPhotoList"), true);
});
