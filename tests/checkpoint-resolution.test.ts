import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkpointBlockedBy,
  checkpointIsResolvable,
  checkpointIsSettled,
  checkpointIsWaivable,
  checkpointReasonIsUsable,
  checkpointWaitingReason,
  MINIMUM_CHECKPOINT_REASON,
} from "@/features/readiness/checkpoint-resolution";
import { weddingCheckpointDefinitions } from "@/features/workflows/starter-templates";

/**
 * `resolveCheckpoint` existed with no caller, so readiness climbed to 38% and
 * stopped on judgements nothing could record. These tests pin who may settle
 * what.
 */

const cp = (completionMethod: string, status = "not_started") => ({
  status,
  completionMethod,
});

test("a judgement is the studio's to settle", () => {
  assert.equal(checkpointIsResolvable(cp("manual")), true);
});

test("anything a record decides is never settled by hand", () => {
  // Marking the retainer paid from the readiness page would be exactly the
  // hole the booking commands take care to avoid.
  for (const method of [
    "invoice_paid",
    "contract_completed",
    "form_submitted",
    "schedule_approved",
    "assignment_accepted",
    "system_rule",
    "file_uploaded",
    "webhook_event",
  ]) {
    assert.equal(
      checkpointIsResolvable(cp(method)),
      false,
      `${method} must wait for its record`,
    );
  }
});

test("a method no one has heard of is treated as evidence-backed", () => {
  assert.equal(checkpointIsResolvable(cp("astrology")), false);
});

test("an already-settled checkpoint offers nothing", () => {
  for (const status of ["complete", "waived"]) {
    assert.equal(checkpointIsSettled(cp("manual", status)), true);
    assert.equal(checkpointIsResolvable(cp("manual", status)), false);
  }
});

test("every evidence-backed row explains what it is waiting for", () => {
  for (const method of [
    "invoice_paid",
    "contract_completed",
    "form_submitted",
    "schedule_approved",
    "assignment_accepted",
    "system_rule",
  ]) {
    const reason = checkpointWaitingReason(cp(method));
    assert.ok(reason && reason.length > 12, `${method} needs a sentence`);
  }
  // A judgement needs no explanation — it has a button instead.
  assert.equal(checkpointWaitingReason(cp("manual")), null);
  assert.equal(checkpointWaitingReason(cp("manual", "complete")), null);
});

test("every wedding checkpoint is either resolvable or explains itself", () => {
  // Guards against a new template arriving that a photographer can neither
  // action nor understand.
  for (const [, name, , , , method] of weddingCheckpointDefinitions) {
    const entry = cp(String(method));
    assert.equal(
      checkpointIsResolvable(entry) || checkpointWaitingReason(entry) !== null,
      true,
      `"${String(name)}" would sit there with no button and no explanation`,
    );
  }
});

test("a reason has to say something, and clear the server's own floor", () => {
  assert.equal(checkpointReasonIsUsable("done"), false);
  assert.equal(checkpointReasonIsUsable("   "), false);
  assert.equal(checkpointReasonIsUsable("Venue confirmed by phone."), true);
  // resolveCheckpoint refuses a waiver reason under ten characters, so the
  // client floor must not be looser than the server's.
  assert.equal(MINIMUM_CHECKPOINT_REASON >= 10, true);
  assert.equal(checkpointReasonIsUsable("confirmed"), false, "9 chars");
  assert.equal(checkpointReasonIsUsable("confirmed."), true, "10 chars");
});

test("a waiver is offered wherever the template allows one", () => {
  // The escape hatch, and deliberately wider than `checkpointIsResolvable`:
  // the checkpoint that most needs waiving is the record-backed one whose
  // record is never going to arrive.
  for (const method of [
    "manual",
    "form_submitted",
    "invoice_paid",
    "schedule_approved",
    "assignment_accepted",
    "system_rule",
    "webhook_event",
  ]) {
    assert.equal(
      checkpointIsWaivable({ status: "not_started", waiverAllowed: true }),
      true,
      `${method} should be waivable when the template allows it`,
    );
  }
  // The record decides, matching resolveCheckpoint's own INVALID_WAIVER check.
  assert.equal(
    checkpointIsWaivable({ status: "not_started", waiverAllowed: false }),
    false,
  );
  // Nothing settled is waivable twice.
  for (const status of ["complete", "waived"]) {
    assert.equal(checkpointIsWaivable({ status, waiverAllowed: true }), false);
  }
});

test("no wedding checkpoint can strand a job with nothing to do", () => {
  // The shipped templates all set waiverAllowed, so every row has either
  // "Mark done" or "Waive". `shot-list-approved` was the counter-example
  // that mattered: form_submitted, blocking, and no form in the product.
  for (const [key, , , , , method] of weddingCheckpointDefinitions) {
    const entry = { status: "not_started", waiverAllowed: true };
    assert.equal(
      checkpointIsResolvable(cp(String(method))) || checkpointIsWaivable(entry),
      true,
      `"${String(key)}" would hold a job below 100% with no way out`,
    );
  }
});

test("a blocked checkpoint offers no Mark done, and names what it waits on", () => {
  /**
   * `resolveCheckpoint` refuses a completion whose dependency is unsatisfied,
   * and the UI never asked — so **Mark done** appeared on blocked rows, took a
   * written reason ("Confirmed St Stephen Church and The Dorrance with both
   * venues by phone") and then failed with "That checkpoint could not be
   * updated." The graph is known before the button renders.
   */
  const dependency = (id: string) =>
    ({
      "cp-form": { name: "Questionnaire complete", settled: false },
      "cp-schedule": { name: "Final run of show approved", settled: true },
    })[id];

  assert.equal(
    checkpointBlockedBy({ dependencyIds: ["cp-form"] }, dependency),
    "Questionnaire complete",
  );
  // Settled by the records counts, exactly as it counts for scoring.
  assert.equal(
    checkpointBlockedBy({ dependencyIds: ["cp-schedule"] }, dependency),
    null,
  );
  assert.equal(checkpointBlockedBy({ dependencyIds: [] }, dependency), null);
  assert.equal(checkpointBlockedBy({}, dependency), null);
  // The nearest unmet link, not the whole chain.
  assert.equal(
    checkpointBlockedBy(
      { dependencyIds: ["cp-schedule", "cp-form"] },
      dependency,
    ),
    "Questionnaire complete",
  );
  // An id that resolves to nothing blocks, matching the server, which refuses
  // when a dependency document cannot be found.
  assert.equal(
    checkpointBlockedBy({ dependencyIds: ["gone"] }, dependency),
    "another step",
  );
});
