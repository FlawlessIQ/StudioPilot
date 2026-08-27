import assert from "node:assert/strict";
import { test } from "node:test";
import {
  INTERRUPTION_COPY,
  interruptionReasonIsUsable,
  interruptionsFor,
  resumeTargetFor,
} from "@/features/projects/interruptions";
import { allowedProjectTransitions } from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

/**
 * A wedding moved to next year and a couple who call it off are ordinary. The
 * product could reach neither state.
 */

test("a live job can be held or called off", () => {
  for (const state of [
    "CONSULTATION",
    "PROPOSAL",
    "CONTRACT_PENDING",
    "RETAINER_PENDING",
    "BOOKED",
    "PLANNING",
    "READY",
  ] as ProjectState[]) {
    assert.deepEqual(
      interruptionsFor(state),
      ["POSTPONED", "CANCELLED"],
      `${state} should offer both`,
    );
  }
});

test("a lead can be cancelled but not held", () => {
  // Nothing is booked yet, so there is no date to move.
  assert.deepEqual(interruptionsFor("LEAD"), ["CANCELLED"]);
});

test("work already under way is not interrupted this way", () => {
  // After the event the job is finished or it is not; a hold would be a
  // fiction, and the state machine says so.
  for (const state of [
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "CLOSED",
  ] as ProjectState[]) {
    assert.deepEqual(interruptionsFor(state), [], state);
  }
});

test("nothing is offered that the state machine would refuse", () => {
  for (const state of Object.keys(allowedProjectTransitions) as ProjectState[]) {
    for (const target of interruptionsFor(state)) {
      assert.ok(
        allowedProjectTransitions[state].includes(target),
        `${state} → ${target} is not allowed`,
      );
    }
  }
});

test("a held job comes back to booked", () => {
  // The signature and retainer are on file; the gate re-checks them against
  // the new date.
  assert.equal(resumeTargetFor("POSTPONED"), "BOOKED");
  assert.equal(resumeTargetFor("BOOKED"), null);
});

test("a reason is required and has to say something", () => {
  assert.equal(interruptionReasonIsUsable("sick"), false);
  assert.equal(interruptionReasonIsUsable("   "), false);
  assert.equal(
    interruptionReasonIsUsable("Moved to next spring after a family illness."),
    true,
  );
});

test("both interruptions explain what happens to the job", () => {
  for (const key of ["POSTPONED", "CANCELLED"] as const) {
    const copy = INTERRUPTION_COPY[key];
    assert.ok(copy.label.length > 5);
    assert.ok(copy.detail.length > 40, `${key} must say what it does`);
    // Neither deletes anything, and both say so.
    assert.match(copy.detail, /kept|preserved|stays on file/);
  }
});
