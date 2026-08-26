import assert from "node:assert/strict";
import { test } from "node:test";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";

/**
 * The end-to-end run of 2026-08-26 hit a dead end on the second step.
 *
 * "It already happened — mark done" moved the project LEAD → CONSULTATION, but
 * the step required rank >= 2 (PROPOSAL) to count as done, and the button is only
 * offered from LEAD. So the step stayed current, the shortcut vanished, and the
 * only remaining action was "Schedule consultation" for a consultation the
 * operator had just said already happened.
 */

const base: JourneyInput = {
  projectId: "p1",
  state: "LEAD",
  eventDate: "2027-07-02",
  today: "2026-08-26",
  lead: { id: "lead-1", status: "converted" },
  hasConsultation: false,
  proposalStatus: null,
  contractStatus: null,
  retainerInvoiceStatus: null,
  finalInvoiceStatus: null,
  questionnaireStatus: null,
  questionnaireHasAnswers: false,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewCascadeActive: false,
  coiStatus: null,
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

const step = (input: JourneyInput, key: string) =>
  projectJourney(input).steps.find((s) => s.key === key);

test("from LEAD the shortcut is offered and targets CONSULTATION", () => {
  const consultation = step(base, "consultation");
  assert.equal(consultation?.status, "current");
  assert.equal(consultation?.advance?.targetState, "CONSULTATION");
});

test("taking the shortcut completes the step", () => {
  // This is the regression: the state the button sets must satisfy the step.
  const after = { ...base, state: "CONSULTATION" };
  assert.equal(step(after, "consultation")?.status, "complete");
});

test("and says plainly that no meeting was recorded", () => {
  const after = { ...base, state: "CONSULTATION" };
  assert.equal(
    step(after, "consultation")?.detail,
    "Marked done — no meeting was recorded",
  );
});

test("a booked meeting still reads as a booked meeting", () => {
  const booked = { ...base, hasConsultation: true };
  assert.equal(step(booked, "consultation")?.detail, "Meeting booked");
  assert.equal(step(booked, "consultation")?.status, "complete");
});

test("the shortcut is not offered once the step is done", () => {
  const after = { ...base, state: "CONSULTATION" };
  assert.equal(step(after, "consultation")?.advance, null);
});

test("the journey moves on rather than stalling", () => {
  // The project must not be left with consultation as the current step after
  // the operator has said it happened.
  const after = projectJourney({ ...base, state: "CONSULTATION" });
  assert.notEqual(after.current?.key, "consultation");
});
