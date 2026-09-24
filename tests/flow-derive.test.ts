import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  deriveFlowRole,
  deriveFlowSubject,
} from "../functions/src/ai/flow-derive.ts";

const ROSTER = ["Marco Silva", "Jordan Reid", "Alex Rivera", "Conor Lawless", "Conor Lawless"];

test("the trade the operator named reaches the ranker", () => {
  assert.equal(
    deriveFlowRole("add marco silva as videographer to the priya and daniel wedding"),
    "Videographer",
  );
  assert.equal(deriveFlowRole("the baumwoll job needs a second shooter"), "Second photographer");
  assert.equal(deriveFlowRole("add albert to 2nd photographer"), "Second photographer");
  assert.equal(deriveFlowRole("who can shoot stills"), "Photographer");
});

/** "Second shooter for the video team" names video, not stills. */
test("video is read before photography when a sentence says both", () => {
  assert.equal(deriveFlowRole("second shooter for the video team"), "Videographer");
});

test("a sentence naming no trade leaves the flow's own default alone", () => {
  assert.equal(deriveFlowRole("staff the demattia wedding"), null);
  assert.equal(deriveFlowRole("add someone for the june wedding"), null);
  assert.equal(deriveFlowRole(""), null);
});

test("a named person is recognised in the roster's own spelling", () => {
  assert.equal(
    deriveFlowSubject("add marco silva as videographer to the june wedding", ROSTER),
    "Marco Silva",
  );
  assert.equal(deriveFlowSubject("ADD JORDAN REID please", ROSTER), "Jordan Reid");
});

/**
 * C2 exists to keep this ambiguous. Guessing past two people with one name is
 * the failure, not the fix.
 */
test("a name two crew share is left for the picker to disambiguate", () => {
  assert.equal(deriveFlowSubject("add conor lawless to the wedding", ROSTER), null);
});

test("nobody named, nobody derived", () => {
  assert.equal(deriveFlowSubject("staff the june wedding", ROSTER), null);
  assert.equal(deriveFlowSubject("add someone", ROSTER), null);
});

/** A surname alone would read "the baumwoll job" as a person. */
test("a partial name is not a match", () => {
  assert.equal(deriveFlowSubject("the silva job needs someone", ROSTER), null);
  assert.equal(deriveFlowSubject("add marco to the wedding", ROSTER), null);
});

const copilot = readFileSync(`${process.cwd()}/functions/src/ai/copilot.ts`, "utf8");

test("the model's own value still wins where it supplies one", () => {
  assert.match(copilot, /result\.flow\.subject \?\?\s*\n?\s*deriveFlowSubject\(input\.question, rosterNames\)/);
  assert.match(copilot, /result\.flow\.role \?\? deriveFlowRole\(input\.question\)/);
});
