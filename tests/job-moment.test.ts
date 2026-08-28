import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECONCILE_TARGETS,
  awaitingEventReconciliation,
  daysToEvent,
  jobIsOver,
  preparationIsMoot,
  preparedWorkIsMoot,
  taskMomentHasGone,
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

/**
 * Preparation ends with the event, not with the job.
 *
 * `workStillMatters` stops at closed, which is a whole stage too late: after a
 * wedding is recorded as shot, Today's single most prominent item was still
 * "Confirm Foundry COI wording" — insurance for an event already on the record
 * as having happened.
 */
test("preparation stops mattering once the event is recorded", () => {
  for (const state of [
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "REVIEW_REQUESTED",
    "CLOSED",
    "CANCELLED",
    "ARCHIVED",
  ]) {
    assert.equal(preparationIsMoot(state), true, state);
  }
});

test("a postponed wedding needs all of its preparation again", () => {
  // It has not happened. Every certificate and timeline matters on the new date.
  assert.equal(preparationIsMoot("POSTPONED"), false);
  assert.equal(preparationIsMoot("READY"), false);
  assert.equal(preparationIsMoot("PLANNING"), false);
});

test("a task is judged by whether its due date was for the event", () => {
  const shot = { state: "EVENT_COMPLETE", eventDate: "2026-08-15" };
  // Due the day before the wedding: that was work for the wedding.
  assert.equal(taskMomentHasGone({ ...shot, dueDate: "2026-08-14" }), true);
  assert.equal(taskMomentHasGone({ ...shot, dueDate: "2026-08-15" }), true);
  // Due afterwards: chase the album, order the prints. Still live.
  assert.equal(taskMomentHasGone({ ...shot, dueDate: "2026-08-16" }), false);
  // Same task, job still ahead of its date: never suppressed.
  assert.equal(
    taskMomentHasGone({ state: "READY", eventDate: "2026-08-15", dueDate: "2026-08-14" }),
    false,
  );
  // Nothing to judge by.
  assert.equal(
    taskMomentHasGone({ ...shot, dueDate: null, eventDate: null }),
    false,
  );
});

test("the delivery draft survives the event; the run-up drafts do not", () => {
  const shot = { state: "EVENT_COMPLETE" };
  assert.equal(
    preparedWorkIsMoot({ ...shot, capability: "delivery_message_draft" }),
    false,
    "the gallery note exists because the event happened",
  );
  for (const capability of [
    "coi_extraction",
    "run_of_show_draft",
    "schedule_draft",
    "crew_recommendation",
    "shot_list_request",
  ]) {
    assert.equal(preparedWorkIsMoot({ ...shot, capability }), true, capability);
  }
  // And nothing is suppressed while the event is still ahead.
  assert.equal(
    preparedWorkIsMoot({ state: "PLANNING", capability: "coi_extraction" }),
    false,
  );
});
