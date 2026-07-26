import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedProjectTransitions,
  assertProjectTransition,
  canTransition,
} from "@/features/projects/state-machine";

test("the normal booking transition is explicit", () => {
  assert.equal(canTransition("RETAINER_PENDING", "BOOKED"), true);
});

test("projects cannot skip required lifecycle states", () => {
  assert.equal(canTransition("LEAD", "READY"), false);
  assert.throws(() => assertProjectTransition("LEAD", "READY"));
});

test("archived projects are terminal", () => {
  assert.deepEqual(allowedProjectTransitions.ARCHIVED, []);
});

test("ready projects can return to planning when a blocker changes", () => {
  assert.equal(canTransition("READY", "PLANNING"), true);
});
