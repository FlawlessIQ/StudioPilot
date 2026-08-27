import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pastConsultation,
  pastProposal,
  stageAtLeast,
  stageRank,
} from "@/features/projects/stage-progress";
import { allowedProjectTransitions } from "@/features/projects/state-machine";

test("a lead is past nothing", () => {
  assert.equal(pastConsultation("LEAD"), false);
  assert.equal(pastProposal("LEAD"), false);
});

test("a consultation is past the consultation but not the proposal", () => {
  // The case the booking page got wrong: marked as handled over the phone, and
  // then told to schedule the consultation it had just recorded.
  assert.equal(pastConsultation("CONSULTATION"), true);
  assert.equal(pastProposal("CONSULTATION"), false);
});

test("a held job keeps everything it had", () => {
  // A wedding moved to next year has a signed contract and a paid retainer on
  // file. Ranking it at zero asked the studio to start again.
  assert.equal(pastProposal("POSTPONED"), true);
  assert.equal(stageAtLeast("POSTPONED", "BOOKED"), true);
  assert.equal(stageAtLeast("POSTPONED", "PLANNING"), false);
});

test("a cancelled job still reads as the job it was", () => {
  assert.equal(pastProposal("CANCELLED"), true);
});

test("post-event states are past the proposal", () => {
  for (const state of [
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "REVIEW_REQUESTED",
    "CLOSED",
  ]) {
    assert.equal(pastProposal(state), true, state);
  }
});

test("every state the machine knows has a rank", () => {
  // An unranked state silently reads as LEAD, which is how the drifting lists
  // caused this in the first place.
  for (const state of Object.keys(allowedProjectTransitions)) {
    assert.ok(
      stageRank(state) > 0 || state === "LEAD",
      `${state} has no rank and would read as a lead`,
    );
  }
});
