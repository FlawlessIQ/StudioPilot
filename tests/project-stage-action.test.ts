import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectStateAdvanceAction,
  projectStateLabel,
} from "../features/projects/state-label.ts";

/**
 * The stage control used to render `Confirm ${projectStateLabel(next)}`, which
 * produced "Confirm Shot" on a wedding that had already happened and "Confirm
 * Proposal out" on a new job. These tests pin the button to a phrase a
 * photographer would actually say.
 */

// Every state the "move this project forward" control can target.
const forwardTargets = [
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
  "REVIEW_REQUESTED",
  "CLOSED",
  "ARCHIVED",
];

test("every forward target has a deliberate action phrase", () => {
  for (const state of forwardTargets) {
    const action = projectStateAdvanceAction(state);
    assert.notEqual(
      action,
      `Move to ${projectStateLabel(state)}`,
      `${state} fell through to the generic fallback`,
    );
  }
});

test("no action phrase is the old Confirm-plus-state-name fragment", () => {
  for (const state of forwardTargets) {
    assert.notEqual(
      projectStateAdvanceAction(state),
      `Confirm ${projectStateLabel(state)}`,
      `${state} still reads as "Confirm <state name>"`,
    );
  }
});

test("the two labels that were plainly wrong now read as sentences", () => {
  // "Confirm Shot" and "Confirm Proposal out" were the ones found in the audit.
  assert.equal(projectStateAdvanceAction("EVENT_COMPLETE"), "Confirm the event happened");
  assert.equal(projectStateAdvanceAction("PROPOSAL"), "Confirm the proposal went out");
});

test("advancing to a state describes the event, not the resulting status", () => {
  // RETAINER_PENDING is displayed as "Awaiting deposit"; you arrive there
  // because the contract got signed, and that is what is being confirmed.
  assert.equal(projectStateLabel("RETAINER_PENDING"), "Awaiting deposit");
  assert.equal(
    projectStateAdvanceAction("RETAINER_PENDING"),
    "Confirm the contract is signed",
  );
  assert.equal(projectStateLabel("BOOKED"), "Booked");
  assert.equal(projectStateAdvanceAction("BOOKED"), "Confirm the deposit is paid");
});

test("an unmapped state still reads as an instruction", () => {
  assert.equal(
    projectStateAdvanceAction("SOME_FUTURE_STATE"),
    "Move to Some future state",
  );
});

test("state names themselves are unchanged, so chips keep reading correctly", () => {
  assert.equal(projectStateLabel("EVENT_COMPLETE"), "Shot");
  assert.equal(projectStateLabel("READY"), "Ready for the day");
});
