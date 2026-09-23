import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A bad turn should reach a test without anyone doing archaeology.
 *
 * Every Cue defect this month became a regression test because a person read a
 * transcript and wrote a scenario by hand. That is the bottleneck: the
 * ampersand matcher took two attempts and a fixture audit before the case it
 * was written for was actually covered, and the thing that finally fixed it was
 * reading the reference studio's real data — not more thinking.
 *
 * The loop: the turn records what the model asked for, which tools ran and
 * which records it saw; the operator says it was wrong; the bridge prints a
 * scenario stub with the retrieval-or-judgement call already made.
 */

const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
const client = readFileSync("lib/ai/copilot-client.ts", "utf8");
const workspace = readFileSync("components/ai/copilot-workspace.tsx", "utf8");
const bridge = readFileSync("scripts/cue-feedback-to-scenarios.mjs", "utf8");

test("a turn can be reported from the answer it belongs to", () => {
  assert.match(workspace, /TurnFeedback/, "every answer needs the control");
  assert.match(client, /kind: "turn_feedback"/);
  assert.match(copilot, /kind === "turn_feedback"/);
});

test("feedback is bound to a turn of the caller's own tenant", () => {
  // An interaction id is guessable, and the record carries the question back
  // out into the tooling.
  const branch = copilot.slice(
    copilot.indexOf('kind === "turn_feedback"'),
    copilot.indexOf('kind === "project_intake"'),
  );
  assert.match(branch, /INTERACTION_NOT_FOUND/);
  assert.match(branch, /interaction\.get\("tenantId"\) !== feedback\.tenantId/);
  assert.match(branch, /internalRoles\.has/, "studio staff only");
});

test("the report carries the diagnostics, which are the point", () => {
  // Without them a complaint is "Cue did something odd yesterday" and the
  // archaeology starts again.
  const branch = copilot.slice(
    copilot.indexOf('kind === "turn_feedback"'),
    copilot.indexOf('kind === "project_intake"'),
  );
  assert.match(branch, /diagnostics: interaction\.get\("diagnostics"\)/);
  assert.match(branch, /question: String\(interaction\.get\("question"\)/);
});

test("the bridge tells you which half failed", () => {
  // The distinction that cost an hour on 2026-09-22: a flow the model never
  // asked for is the model's; a flow we could not aim is ours.
  assert.match(bridge, /dropped_unresolved_project/);
  assert.match(bridge, /not_requested/);
  assert.match(bridge, /RETRIEVAL/);
  assert.match(bridge, /OURS/);
  assert.match(bridge, /MODEL/);
});

test("the bridge proposes, and does not write the test itself", () => {
  // A scenario needs an expected answer, and only a person knows what the
  // turn should have done. What is removed is the archaeology, not the
  // judgement.
  assert.match(bridge, /It does NOT write them/);
  assert.doesNotMatch(bridge, /writeFileSync/);
});
