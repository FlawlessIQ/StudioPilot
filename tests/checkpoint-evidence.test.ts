import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkpointSatisfiedByEvidence,
  noReadinessEvidence,
  readinessEvidenceFromFacts,
  type ReadinessEvidence,
} from "@/features/readiness/checkpoint-evidence";
import { weddingCheckpointDefinitions } from "@/features/workflows/starter-templates";

/**
 * The walk of 2026-08-26 ended with a booked wedding at 0% ready and 13
 * blockers, five of which named work that was demonstrably finished. These
 * tests pin the link between a checkpoint's declared completionMethod and the
 * records that satisfy it — and, just as importantly, what must NOT satisfy it.
 */

const cp = (templateKey: string, completionMethod: string) => ({
  templateKey,
  completionMethod,
  blocking: true,
  status: "not_started",
});

const all: ReadinessEvidence = {
  contractCompleted: true,
  retainerPaid: true,
  finalBalancePaid: true,
  questionnaireAnswered: true,
  scheduleApproved: true,
  crewAccepted: true,
  crewAcknowledgedSchedule: true,
  shotListApproved: true,
};

test("each record-backed checkpoint is satisfied by its own evidence", () => {
  const cases: Array<[string, string, keyof ReadinessEvidence]> = [
    ["contract-completed", "contract_completed", "contractCompleted"],
    ["retainer-paid", "invoice_paid", "retainerPaid"],
    ["final-balance", "invoice_paid", "finalBalancePaid"],
    ["questionnaire-complete", "form_submitted", "questionnaireAnswered"],
    ["schedule-approved", "schedule_approved", "scheduleApproved"],
    ["crew-accepted", "assignment_accepted", "crewAccepted"],
    ["crew-acknowledged", "assignment_accepted", "crewAcknowledgedSchedule"],
    ["shot-list-approved", "form_submitted", "shotListApproved"],
  ];
  for (const [key, method, field] of cases) {
    const only = { ...noReadinessEvidence, [field]: true };
    assert.equal(
      checkpointSatisfiedByEvidence(cp(key, method), only),
      true,
      `${key} should be satisfied by ${field}`,
    );
  }
});

test("adjacent evidence never ticks a neighbouring checkpoint", () => {
  // A shot list is not a details form.
  assert.equal(
    checkpointSatisfiedByEvidence(cp("shot-list-approved", "form_submitted"), {
      ...noReadinessEvidence,
      questionnaireAnswered: true,
    }),
    false,
  );
  // Accepting the booking is not reading the schedule you will shoot from.
  assert.equal(
    checkpointSatisfiedByEvidence(cp("crew-acknowledged", "assignment_accepted"), {
      ...noReadinessEvidence,
      crewAccepted: true,
    }),
    false,
  );
  // The retainer is not the final balance.
  assert.equal(
    checkpointSatisfiedByEvidence(cp("final-balance", "invoice_paid"), {
      ...noReadinessEvidence,
      retainerPaid: true,
    }),
    false,
  );
});

test("manual checkpoints are never inferred, however much is proven", () => {
  for (const key of [
    "venue-confirmed",
    "primary-contacts",
    "coi-approved",
    "locations-confirmed",
    "travel-confirmed",
  ]) {
    assert.equal(
      checkpointSatisfiedByEvidence(cp(key, "manual"), all),
      false,
      `${key} is a judgement, not a record`,
    );
  }
});

test("a checkpoint a studio invented is not ticked by a rule that never heard of it", () => {
  assert.equal(
    checkpointSatisfiedByEvidence(cp("drone-permit", "form_submitted"), all),
    false,
  );
  assert.equal(
    checkpointSatisfiedByEvidence(cp("contract-completed", "sixth_sense"), all),
    false,
  );
});

test("every starter definition is either record-backed or honestly manual", () => {
  // Guards against a new checkpoint template arriving with a completionMethod
  // this mapping does not handle, which would silently make it a permanent
  // blocker. Either teach the mapping, or declare it manual on purpose.
  for (const [templateKey, name, , , , completionMethod] of weddingCheckpointDefinitions) {
    const satisfiable = checkpointSatisfiedByEvidence(
      cp(String(templateKey), String(completionMethod)),
      all,
    );
    assert.equal(
      satisfiable || completionMethod === "manual",
      true,
      `"${String(name)}" declares ${String(completionMethod)} but no evidence can satisfy it`,
    );
  }
});

test("the builder uses substance, not status strings", () => {
  const base = {
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: "sent",
    questionnaireStatus: "submitted",
    questionnaireAnswers: { planner: "The Marriott from 1pm" },
    scheduleStatus: "approved",
    scheduleItems: [{ startAt: "2027-07-02T17:00:00Z", title: "Ceremony" }],
    crewAccepted: 1,
    crewRequired: 1,
  };
  const proven = readinessEvidenceFromFacts(base);
  assert.equal(proven.contractCompleted, true);
  assert.equal(proven.retainerPaid, true);
  assert.equal(proven.finalBalancePaid, false, "sent is not paid");
  assert.equal(proven.questionnaireAnswered, true);
  assert.equal(proven.scheduleApproved, true);
  assert.equal(proven.crewAccepted, true);

  // The two defects the 2026-08-20 audit found must not come back through
  // this door: a settled status with nothing behind it is not evidence.
  assert.equal(
    readinessEvidenceFromFacts({ ...base, questionnaireAnswers: {} })
      .questionnaireAnswered,
    false,
  );
  assert.equal(
    readinessEvidenceFromFacts({ ...base, scheduleItems: [] }).scheduleApproved,
    false,
  );
  assert.equal(
    readinessEvidenceFromFacts({
      ...base,
      scheduleItems: [{ startAt: "not a date", title: "Ceremony" }],
    }).scheduleApproved,
    false,
    "an approved schedule no reader can parse is not an approved schedule",
  );
});

test("a solo wedding is not held open by a crew role that does not exist", () => {
  assert.equal(
    readinessEvidenceFromFacts({
      contractStatus: "completed",
      retainerInvoiceStatus: "paid",
      finalInvoiceStatus: "paid",
      questionnaireStatus: "submitted",
      questionnaireAnswers: { a: "b" },
      scheduleStatus: "approved",
      scheduleItems: [{ startAt: "2027-07-02T17:00:00Z", title: "Ceremony" }],
      crewAccepted: 0,
      crewRequired: 0,
    }).crewAccepted,
    true,
  );
  // But a role that was offered and not accepted is still outstanding.
  assert.equal(
    readinessEvidenceFromFacts({
      contractStatus: "completed",
      retainerInvoiceStatus: "paid",
      finalInvoiceStatus: "paid",
      questionnaireStatus: "submitted",
      questionnaireAnswers: { a: "b" },
      scheduleStatus: "approved",
      scheduleItems: [{ startAt: "2027-07-02T17:00:00Z", title: "Ceremony" }],
      crewAccepted: 0,
      crewRequired: 2,
    }).crewAccepted,
    false,
  );
});
