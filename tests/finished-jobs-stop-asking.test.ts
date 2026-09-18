import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { jobIsOver } from "../features/projects/job-moment";

/**
 * A finished job stops being scored on the day it already had.
 *
 * A closed, archived wedding still advertised "8 things before the day:
 * Questionnaire complete +7 more", "Primary contacts confirmed and 4 other
 * checks are still yours to confirm — Confirm what you know", and wore
 * "38% ready" in its header. Readiness is about being ready for a day that is
 * three weeks past, on a job that finished successfully.
 *
 * The "N missed" count deliberately stays: those steps genuinely were skipped,
 * and softening an honest record would be the worse bug.
 */

test("readiness is suppressed once a job is put away or closed", () => {
  assert.equal(jobIsOver("CLOSED"), true);
  assert.equal(jobIsOver("ARCHIVED"), true);
  assert.equal(jobIsOver("CANCELLED"), true);
  assert.equal(jobIsOver("DELIVERED"), false);

  const detail = readFileSync(
    `${process.cwd()}/components/projects/live-project-detail.tsx`,
    "utf8",
  );
  assert.match(detail, /const jobOver = jobIsOver\(state\);/);
  assert.match(detail, /const outstanding = jobOver \? \[\] : readinessView\.blocking;/);
  assert.match(detail, /const studioOpenWork = \(jobOver \? \[\] : \(checkpoints \?\? \[\]\)\)/);

  const header = readFileSync(
    `${process.cwd()}/components/studio/live-domain-view.tsx`,
    "utf8",
  );
  assert.match(
    header,
    /readinessView\.tracked && !jobIsOver\(state\)/,
    "the project header must not wear a readiness ring on a finished job",
  );
});

/**
 * An enquiry whose date has gone by is a stale enquiry, not an unrecorded
 * wedding — reconciliation rightly leaves it alone. But the journey then went
 * on proposing "Schedule consultation · Find a time that works" for a date
 * twenty days past, which reads as though nobody had looked at the date.
 */
const lead = (eventDate: string): JourneyInput => ({
  projectId: "p1",
  state: "LEAD",
  eventDate,
  today: "2026-09-18",
  lead: { id: "l1", status: "new" },
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
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "unknown",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
});

const consultationStep = (eventDate: string) =>
  projectJourney(lead(eventDate)).steps.find(
    (step) => step.key === "consultation",
  );

test("a lead whose date has passed is not offered a consultation as if it were ahead", () => {
  const consultation = consultationStep("2026-08-29");
  assert.ok(consultation, "the consultation step should exist");
  assert.match(String(consultation?.detail), /passed 20 days ago/);
  assert.ok(
    !/Find a time that works/.test(String(consultation?.detail)),
    "it should not read as though the date were still ahead",
  );
});

test("a lead whose date is still ahead is offered the consultation normally", () => {
  assert.equal(consultationStep("2027-08-29")?.detail, "Find a time that works");
});
