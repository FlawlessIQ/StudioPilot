import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  crewRequirementsFor,
  requireInsuranceOf,
} from "@/features/crew/requirements";

/**
 * What a subcontractor has to supply before they work a job.
 *
 * From the reference studio's live test: "Get rid of insurance. Most studios
 * will operate under their insurance. Make them upload their w9!" It was
 * hard-coded `required: true` in three separate places, and missing insurance
 * also dragged a candidate down the ranking.
 */

test("insurance is off unless the studio turns it on", () => {
  for (const settings of [null, undefined, {}, { requireInsurance: false }])
    assert.equal(requireInsuranceOf(settings), false, JSON.stringify(settings));
  assert.equal(requireInsuranceOf({ requireInsurance: true }), true);
});

test("a studio that has said nothing asks for the W-9 and the schedule only", () => {
  const ids = crewRequirementsFor(null).map((item) => item.id);
  assert.deepEqual(ids, ["w9", "schedule"]);
});

test("a studio that requires cover gets the certificate back", () => {
  const ids = crewRequirementsFor({ requireInsurance: true }).map((i) => i.id);
  assert.deepEqual(ids, ["w9", "insurance", "schedule"]);
});

/** The W-9 is how the studio pays them; it is never optional. */
test("every requirement that ships is required", () => {
  for (const settings of [null, { requireInsurance: true }])
    for (const item of crewRequirementsFor(settings))
      assert.equal(item.required, true, item.id);
});

/**
 * One list, read everywhere.
 *
 * The three sites that used to hard-code it — the copilot flow, the cascade
 * screen and the booking-time staffing plan — must all go through this module,
 * or the next studio setting only takes effect on two of the three.
 */
test("nothing builds its own requirement list", () => {
  const readers = [
    "components/ai/flow-runner.tsx",
    "components/crew/crew-cascade-workspace.tsx",
    "functions/src/crew/prepare-staffing.ts",
  ];
  for (const path of readers) {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    assert.match(source, /crewRequirementsFor\(/, path);
    assert.doesNotMatch(
      source,
      /kind:\s*"insurance"/,
      `${path} still spells out a requirement of its own`,
    );
  }
});

/**
 * `functions/` is its own package with no `@/features` path, so the module is
 * duplicated. Compare below the headers.
 */
test("the functions copy of the requirements matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export type CrewRequirement"));
  };
  assert.equal(
    body("functions/src/crew/requirements.ts"),
    body("features/crew/requirements.ts"),
  );
});
