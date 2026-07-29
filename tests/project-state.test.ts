import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedProjectTransitions,
  assertManualProjectTransition,
  assertProjectTransition,
  canTransition,
  transitionAuthority,
} from "@/features/projects/state-machine";

test("the normal booking transition is explicit", () => {
  assert.equal(canTransition("RETAINER_PENDING", "BOOKED"), true);
  assert.equal(
    transitionAuthority("RETAINER_PENDING", "BOOKED"),
    "booking_gate",
  );
  assert.throws(
    () => assertManualProjectTransition("RETAINER_PENDING", "BOOKED"),
    /booking gate evidence/i,
  );
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

test("provider and evidence controlled transitions cannot be performed manually", () => {
  assert.throws(
    () => assertManualProjectTransition("PROPOSAL", "CONTRACT_PENDING"),
    /proposal evidence/i,
  );
  assert.throws(
    () => assertManualProjectTransition("CONTRACT_PENDING", "RETAINER_PENDING"),
    /docusign evidence/i,
  );
  assert.throws(
    () => assertManualProjectTransition("PLANNING", "READY"),
    /readiness evidence/i,
  );
  assert.throws(
    () => assertManualProjectTransition("POST_PRODUCTION", "DELIVERED"),
    /delivery evidence/i,
  );
  assert.doesNotThrow(() =>
    assertManualProjectTransition("BOOKED", "PLANNING"),
  );
});
