import assert from "node:assert/strict";
import { test } from "node:test";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import {
  questionnaireHasAnswers,
  questionnaireIsAnswered,
  questionnaireIsEmptyButSubmitted,
  scheduleIsEmptyButSettled,
  scheduleIsUsable,
} from "@/features/journey/substance";

/**
 * The audit of 2026-08-26 found five places where a status field was trusted and
 * the payload behind it was empty, so a wedding three days out reported 100%
 * readiness with no run of show, no crew brief and an empty questionnaire.
 *
 * These tests pin the rule: completion needs a settled status AND content.
 */

test("an approved schedule with readable items is usable", () => {
  assert.equal(
    scheduleIsUsable({
      status: "approved",
      items: [{ startAt: "2026-08-29T17:00:00Z", title: "Ceremony" }],
    }),
    true,
  );
});

test("an approved schedule whose items no reader understands is not usable", () => {
  // The exact stored shape found in production.
  const items = [
    { time: "13:00", label: "Getting ready — bridal suite" },
    { time: "16:30", label: "Ceremony" },
  ];
  assert.equal(scheduleIsUsable({ status: "approved", items }), false);
  assert.equal(scheduleIsEmptyButSettled({ status: "approved", items }), true);
});

test("a draft schedule is neither usable nor 'empty but settled'", () => {
  const input = { status: "draft", items: [] };
  assert.equal(scheduleIsUsable(input), false);
  // Not settled, so it is simply unfinished — not a contradiction to report.
  assert.equal(scheduleIsEmptyButSettled(input), false);
});

test("a missing schedule is not usable and is not settled-but-empty", () => {
  assert.equal(scheduleIsUsable({ status: null, items: null }), false);
  assert.equal(scheduleIsEmptyButSettled({ status: null, items: null }), false);
});

test("questionnaire answers must contain something", () => {
  assert.equal(questionnaireHasAnswers({}), false);
  assert.equal(questionnaireHasAnswers(null), false);
  assert.equal(questionnaireHasAnswers({ ceremony: "" }), false);
  assert.equal(questionnaireHasAnswers({ ceremony: "   " }), false);
  assert.equal(questionnaireHasAnswers({ family: [] }), false);
  assert.equal(questionnaireHasAnswers({ notes: {} }), false);
  assert.equal(questionnaireHasAnswers({ ceremony: "4:30pm" }), true);
  assert.equal(questionnaireHasAnswers({ family: ["Mum"] }), true);
  assert.equal(questionnaireHasAnswers({ guests: 0 }), true);
  assert.equal(questionnaireHasAnswers({ confirmed: false }), true);
});

test("a submitted questionnaire with no answers is not answered", () => {
  // This is what the production document actually held.
  const input = { status: "submitted", answers: {} };
  assert.equal(questionnaireIsAnswered(input), false);
  assert.equal(questionnaireIsEmptyButSubmitted(input), true);
});

const booked: JourneyInput = {
  projectId: "project-1",
  state: "PLANNING",
  eventDate: "2026-10-14",
  today: "2026-10-01",
  lead: null,
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: "paid",
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: "approved",
  scheduleHasUsableItems: true,
  crewAccepted: 2,
  crewCascadeActive: false,
  coiStatus: "venue_acknowledged",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

const step = (input: JourneyInput, key: string) =>
  projectJourney(input).steps.find((s) => s.key === key);

test("run of show is complete only when the schedule has usable items", () => {
  assert.equal(step(booked, "run_of_show")?.status, "complete");
  const empty = { ...booked, scheduleHasUsableItems: false };
  assert.notEqual(
    step(empty, "run_of_show")?.status,
    "complete",
    "an approved but empty schedule must not report complete",
  );
});

test("an approved-but-empty schedule says so, and offers to fix it", () => {
  const empty = { ...booked, scheduleHasUsableItems: false };
  const runOfShow = step(empty, "run_of_show");
  assert.equal(runOfShow?.detail, "Approved, but it has no times in it yet");
  assert.equal(runOfShow?.status, "current");
  assert.equal(
    runOfShow?.action?.kind === "link" ? runOfShow.action.label : null,
    "Add the times",
  );
});

test("the details form is complete only when answers came through", () => {
  assert.equal(step(booked, "schedule_form")?.status, "complete");
  const empty = { ...booked, questionnaireHasAnswers: false };
  assert.notEqual(step(empty, "schedule_form")?.status, "complete");
});

test("a submitted-but-empty form is the studio's to chase, not the client's", () => {
  const empty = { ...booked, questionnaireHasAnswers: false };
  const form = step(empty, "schedule_form");
  assert.equal(form?.detail, "Marked submitted, but no answers came through");
  // Not waiting_client: the client believes they sent it.
  assert.equal(form?.status, "current");
  assert.equal(
    form?.action?.kind === "link" ? form.action.label : null,
    "Check the form",
  );
});

test("an empty schedule cannot be hidden behind a settled status in the count", () => {
  // The regression that mattered: 100% readiness on a job with no run of show.
  const empty = { ...booked, scheduleHasUsableItems: false };
  const complete = projectJourney(empty).steps.filter(
    (s) => s.status === "complete",
  );
  assert.ok(
    !complete.some((s) => s.key === "run_of_show"),
    "run_of_show must not be counted complete",
  );
  const full = projectJourney(booked).steps.filter(
    (s) => s.status === "complete",
  );
  assert.ok(
    full.length > complete.length,
    "the empty schedule must lower the completed count",
  );
});
