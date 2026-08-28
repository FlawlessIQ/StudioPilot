import assert from "node:assert/strict";
import { test } from "node:test";
import {
  awaitingEventReconciliation,
  daysToEvent,
  jobIsOver,
  RECONCILE_TARGETS,
  workStillMatters,
} from "@/features/projects/job-moment";
import { allowedProjectTransitions } from "@/features/projects/state-machine";
import { projectJourney } from "@/features/journey/steps";

test("a finished job stops generating work", () => {
  // A delivery note waited for approval on a closed job; an overdue task
  // demanded a second shooter for a cancelled one.
  for (const state of ["CLOSED", "CANCELLED", "ARCHIVED"]) {
    assert.equal(jobIsOver(state), true, state);
    assert.equal(workStillMatters(state), false, state);
  }
});

test("a live job keeps generating work, even past its date", () => {
  // Hiding work here would be a guess: if the wedding was postponed rather
  // than shot, the COI wording still matters.
  for (const state of ["BOOKED", "PLANNING", "READY", "POST_PRODUCTION", "DELIVERED"]) {
    assert.equal(workStillMatters(state), true, state);
  }
  // Including a job on hold — it is coming back.
  assert.equal(workStillMatters("POSTPONED"), true);
});

test("days to the event go negative once it is behind them", () => {
  assert.equal(daysToEvent("2026-09-04", "2026-08-28"), 7);
  assert.equal(daysToEvent("2026-08-15", "2026-08-28"), -13);
  assert.equal(daysToEvent(null, "2026-08-28"), null);
  assert.equal(daysToEvent("not-a-date", "2026-08-28"), null);
});

test("a booked job whose date has gone by needs reconciling", () => {
  for (const state of ["BOOKED", "PLANNING", "READY"]) {
    assert.equal(
      awaitingEventReconciliation({
        state,
        eventDate: "2026-08-15",
        today: "2026-08-28",
      }),
      true,
      state,
    );
  }
});

test("a stale enquiry is not an unrecorded wedding", () => {
  // A lead with an old date is somebody who never booked, and asking "did this
  // happen?" of them is nonsense.
  for (const state of ["LEAD", "CONSULTATION", "PROPOSAL", "CONTRACT_PENDING"]) {
    assert.equal(
      awaitingEventReconciliation({
        state,
        eventDate: "2026-08-15",
        today: "2026-08-28",
      }),
      false,
      state,
    );
  }
});

test("nothing is asked of a job whose date is still ahead, or already settled", () => {
  assert.equal(
    awaitingEventReconciliation({
      state: "PLANNING",
      eventDate: "2027-08-15",
      today: "2026-08-28",
    }),
    false,
  );
  for (const state of ["EVENT_COMPLETE", "POST_PRODUCTION", "CLOSED", "CANCELLED"]) {
    assert.equal(
      awaitingEventReconciliation({
        state,
        eventDate: "2026-08-15",
        today: "2026-08-28",
      }),
      false,
      state,
    );
  }
});

test("every reconcile target is a move the state machine allows", () => {
  // The answer to "did this happen?" has to be a move the job can actually
  // make, from each state that can be asked.
  for (const from of ["BOOKED", "PLANNING", "READY"] as const) {
    for (const target of RECONCILE_TARGETS) {
      assert.ok(
        allowedProjectTransitions[from].includes(target),
        `${from} → ${target} is offered but not allowed`,
      );
    }
  }
});

test("a past-date job is asked whether it happened, before anything else", () => {
  const stranded = {
    projectId: "p1",
    state: "PLANNING" as const,
    eventDate: "2026-08-15",
    today: "2026-08-28",
    lead: null,
    hasConsultation: true,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    // An unpaid, overdue balance — which would otherwise claim the next move.
    finalInvoiceStatus: "sent",
    finalInvoiceOverdue: true,
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
  const journey = projectJourney(stranded);
  assert.equal(journey.current?.key, "event_day");
  assert.match(journey.current?.title ?? "", /Did this go ahead/);
  // And it offers the answer, not an instruction.
  assert.equal(journey.current?.advance?.targetState, "EVENT_COMPLETE");
  assert.equal(journey.current?.action, null);

  // Once answered, the job behaves normally again.
  const shot = projectJourney({ ...stranded, state: "EVENT_COMPLETE" });
  assert.notEqual(shot.current?.key, "event_day");
});
