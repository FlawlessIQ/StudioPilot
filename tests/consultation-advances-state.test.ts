import assert from "node:assert/strict";
import { test } from "node:test";
import {
  consultationBookingAdvancesTo,
  evidenceControlledProjectTransitions,
} from "@/features/projects/state-machine";
import type { ProjectState } from "@/features/projects/schema";

/**
 * The end-to-end walk of 2026-08-26 stopped here: a consultation booked inside
 * StudioCue ticked the journey step but left the project at LEAD, and the
 * booking workspace then refused the notes because the project "is still marked
 * as a lead". The only way forward was the manual override, which is documented
 * as being for work done outside the product.
 */

test("booking a consultation moves a lead into the conversation", () => {
  assert.equal(consultationBookingAdvancesTo("LEAD"), "CONSULTATION");
});

test("a consultation booked later in the job never drags it backwards", () => {
  const later: ProjectState[] = [
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
    "CANCELLED",
    "POSTPONED",
    "ARCHIVED",
  ];
  for (const state of later) {
    assert.equal(
      consultationBookingAdvancesTo(state),
      null,
      `${state} should not be advanced by a consultation booking`,
    );
  }
});

test("the manual path stays open, because phone consultations are real", () => {
  // If LEAD → CONSULTATION were listed as evidence-controlled, the stage
  // control would refuse it and a consultation held over the phone could never
  // be recorded. The booking makes the evidence sufficient, not mandatory.
  const listed = evidenceControlledProjectTransitions.some(
    (transition) => transition.from === "LEAD",
  );
  assert.equal(listed, false);
});
