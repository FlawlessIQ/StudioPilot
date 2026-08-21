import assert from "node:assert/strict";
import test from "node:test";
import { journeyPhaseOrder } from "@/features/journey/phases";
import {
  projectPhase,
  projectPhaseIndex,
} from "@/features/projects/lifecycle";
import { projectStateSchema } from "@/features/projects/schema";

test("every live project state sits in one of the five arcs", () => {
  // A state with no arc draws no track, which on a working job would read
  // as "not started". Only the states that have left the lifecycle may.
  // POSTPONED is in the arcs somewhere, but the state no longer says
  // where — drawing nothing beats guessing.
  const left = new Set(["CANCELLED", "ARCHIVED", "POSTPONED"]);
  for (const state of projectStateSchema.options) {
    const phase = projectPhase(state);
    if (left.has(state)) {
      assert.equal(phase, null, `${state} has left the lifecycle`);
      continue;
    }
    assert.ok(
      phase && journeyPhaseOrder.includes(phase),
      `${state} has no arc — the Jobs table would draw it an empty track`,
    );
  }
});

test("the arcs run forwards through the lifecycle", () => {
  const order = [
    "LEAD",
    "CONSULTATION",
    "PROPOSAL",
    "CONTRACT_PENDING",
    "RETAINER_PENDING",
    "BOOKED",
    "PLANNING",
    "READY",
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
  ];
  const indexes = order.map((state) => projectPhaseIndex(state));
  assert.deepEqual(
    indexes,
    [...indexes].sort((a, b) => a - b),
    "a later state landed in an earlier arc",
  );
  assert.equal(projectPhaseIndex("LEAD"), 1);
  assert.equal(projectPhaseIndex("DELIVERED"), 5);
});

test("states outside the lifecycle have no position in it", () => {
  assert.equal(projectPhaseIndex("CANCELLED"), 0);
  assert.equal(projectPhaseIndex("ARCHIVED"), 0);
  assert.equal(projectPhaseIndex("nonsense"), 0);
});

test("two states can share an arc — that is the point", () => {
  // "Booked" and "Awaiting deposit" wear different chip colours and are
  // the same moment in the season. The chip answers "is this one fine",
  // the arc answers "where is it".
  assert.equal(projectPhaseIndex("BOOKED"), projectPhaseIndex("RETAINER_PENDING"));
});
