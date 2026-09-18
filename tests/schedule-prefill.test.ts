import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { starterQuestionnaires } from "@/features/questionnaires/starter-templates";

/**
 * The run-of-show generator fills itself from the couple's answers.
 *
 * It always meant to — but every lookup named a field id no starter
 * questionnaire has (`ceremony-location`, `coverageEndTime`,
 * `gettingReadyLocation`), so on a real wedding the form opened blank minutes
 * after the couple had answered exactly those questions, and the studio
 * retyped the ceremony time, both addresses and the end time by hand.
 */
const generator = readFileSync(
  `${process.cwd()}/components/planning/ai-schedule-generator.tsx`,
  "utf8",
);

const starterIds = new Set(
  starterQuestionnaires().flatMap((starter) =>
    starter.sections.flatMap((section) => section.fields.map((field) => field.id)),
  ),
);

test("the answers that shape a day are looked up by their real ids", () => {
  for (const id of [
    "ceremony-time",
    "end-time",
    "getting-ready",
    "ceremony-address",
    "reception-address",
    "must-have-groups",
    "no-photo-list",
    "sensitivities",
    "restrictions",
    "accessibility",
    "first-look",
  ]) {
    assert.ok(starterIds.has(id), `${id} is not a starter field any more`);
    assert.ok(
      generator.includes(`"${id}"`),
      `the generator never looks for ${id}, so it will not prefill`,
    );
  }
});

test("older aliases stay for studios whose own forms use them", () => {
  for (const alias of ["ceremonyTime", "coverageEndTime", "gettingReadyLocation"]) {
    assert.ok(generator.includes(`"${alias}"`));
  }
});
