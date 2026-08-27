import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkpointIsResolvable,
  checkpointIsSettled,
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
