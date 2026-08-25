import assert from "node:assert/strict";
import test from "node:test";
import { BookingGateService, evaluateBookingGate, type BookingCompletionStore } from "@/server/services/booking-gate-service";

const completeEvidence = {
  contractCompleted: true,
  contractAttestedManually: false,
  retainerInvoiceCreated: true,
  retainerSatisfied: true,
  retainerExceptionApproved: false,
  eventDateAvailable: true,
  requiredContactsComplete: true,
};

test("booking gate cannot pass while a deterministic requirement is missing", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, contractCompleted: false },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["Docusign contract completed"]);
});

test("the contract-completed requirement is labeled for the active signing provider", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, contractCompleted: false },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["Dropbox Sign contract completed"]);
  assert.equal(result.requirements.find((item) => item.key === "contractCompleted")?.source, "dropbox_sign");
});

test("an approved retainer exception is explicit gate evidence", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, retainerSatisfied: false, retainerExceptionApproved: true },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(result.passed, true);
  assert.equal(result.requirements.find((item) => item.key === "retainerSatisfied")?.source, "approved_exception");
});

test("booking completion side effects execute exactly once", async () => {
  let completed: { projectId: string } | null = null;
  const store: BookingCompletionStore = {
    async getCompletedRun() { return completed; },
    async completeAtomically(input) { completed = { projectId: input.projectId }; },
  };
  let executions = 0;
  const steps = {
    async createProjectFolders() { executions += 1; return { id: "folder", path: "/StudioCue/2026/project" }; },
    async createProductionEvent() { executions += 1; return { id: "event" }; },
    async instantiateWorkflow() { executions += 1; return { id: "workflow" }; },
    async activateClientPortal() { executions += 1; return { id: "portal" }; },
    async sendConfirmation() { executions += 1; return { id: "message" }; },
  };
  const service = new BookingGateService(store, () => "2026-07-26T12:00:00.000Z");
  const input = { tenantId: "tenant-a", projectId: "project-a", idempotencyKey: "booking:project-a", evidence: completeEvidence, steps };
  assert.equal((await service.complete(input)).completed, true);
  assert.equal((await service.complete(input)).completed, true);
  assert.equal(executions, 5);
});

/**
 * Signing providers charge for API access, and without one a project could
 * not leave CONTRACT_PENDING by any route — the transition is
 * evidence-controlled and only a provider webhook ever wrote it. Payment
 * already had `retainerExceptionApproved`; signing had nothing.
 *
 * A studio owner attesting is a legitimate authority. It is not the same
 * claim as a provider verifying, so the gate passes on it but never calls
 * it a provider signature.
 */
test("a manually attested signature satisfies the gate", () => {
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: true,
    },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  });
  assert.equal(result.passed, true);
  assert.deepEqual(result.blockers, []);
});

test("an attested signature is never reported as the provider's", () => {
  const attested = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: true,
    },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  }).requirements.find((item) => item.key === "contractCompleted");

  assert.equal(attested?.source, "manual_attestation");
  assert.match(attested?.label ?? "", /recorded by the studio/i);

  // And a real provider completion still reports the provider, so the two
  // can never be confused in the record.
  const verified = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: { ...completeEvidence, contractAttestedManually: false },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
    signingProvider: "dropbox_sign",
  }).requirements.find((item) => item.key === "contractCompleted");

  assert.equal(verified?.source, "dropbox_sign");
});

test("an attested signature still cannot excuse an unpaid retainer", () => {
  // The escape hatch is for the signature only. Nothing about attesting to
  // a signature says anything about money having moved.
  const result = evaluateBookingGate({
    tenantId: "tenant-a",
    projectId: "project-a",
    evidence: {
      ...completeEvidence,
      contractCompleted: false,
      contractAttestedManually: true,
      retainerSatisfied: false,
      retainerExceptionApproved: false,
    },
    evaluatedAt: "2026-07-26T12:00:00.000Z",
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.blockers, ["Retainer paid"]);
});
