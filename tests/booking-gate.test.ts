import assert from "node:assert/strict";
import test from "node:test";
import { BookingGateService, evaluateBookingGate, type BookingCompletionStore } from "@/server/services/booking-gate-service";

const completeEvidence = {
  contractCompleted: true,
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
