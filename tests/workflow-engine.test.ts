import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AuditEvent } from "@/features/audit/schema";
import type { Checkpoint } from "@/features/checkpoints/schema";
import type { WorkflowRun } from "@/features/workflows/schema";
import { resolveDueDate } from "@/features/workflows/relative-date";
import {
  WorkflowService,
  type WorkflowInstantiationStore,
} from "@/server/services/workflow-service";
import {
  workflowProject,
  workflowTemplate,
  workflowTimestamp,
} from "./fixtures/workflow";

class MemoryWorkflowStore implements WorkflowInstantiationStore {
  run: WorkflowRun | null = null;
  checkpoints: readonly Checkpoint[] = [];
  audit: AuditEvent | null = null;

  async findActiveRun() {
    return this.run;
  }

  async createRunWithCheckpoints(
    run: WorkflowRun,
    checkpoints: readonly Checkpoint[],
    audit: AuditEvent,
  ) {
    this.run = run;
    this.checkpoints = checkpoints;
    this.audit = audit;
  }
}

const ownerContext = {
  userId: "owner",
  tenantId: "tenant-a",
  membershipTenantId: "tenant-a",
  role: "studio_owner" as const,
};

test("relative dates resolve deterministically from each supported anchor", () => {
  const anchors = {
    eventDate: "2026-10-03",
    projectCreatedDate: "2026-06-01",
    bookingDate: "2026-06-10",
    workflowStartedDate: "2026-06-10",
  };
  assert.equal(
    resolveDueDate(
      { type: "relative", anchor: "event_date", offsetDays: -14 },
      anchors,
    ),
    "2026-09-19",
  );
  assert.equal(
    resolveDueDate(
      { type: "relative", anchor: "booking_date", offsetDays: 2 },
      anchors,
    ),
    "2026-06-12",
  );
  assert.equal(resolveDueDate({ type: "none" }, anchors), null);
});

test("workflow instantiation snapshots a version and resolves dependencies once", async () => {
  const store = new MemoryWorkflowStore();
  const ids = ["run-1", "checkpoint-contract", "checkpoint-retainer", "audit-1"];
  const service = new WorkflowService(
    store,
    () => ids.shift() ?? "unexpected",
    () => workflowTimestamp,
  );
  const result = await service.instantiate(
    ownerContext,
    workflowProject,
    structuredClone(workflowTemplate),
    "correlation-1",
    "2026-06-10",
  );

  assert.equal(result.existing, false);
  assert.equal(result.run.workflowVersion, 3);
  assert.equal(result.checkpoints[0]?.status, "ready");
  assert.equal(result.checkpoints[1]?.status, "not_started");
  assert.deepEqual(result.checkpoints[1]?.dependencyIds, ["checkpoint-contract"]);
  assert.equal(result.checkpoints[0]?.resolvedDueDate, "2026-06-05");

  const changedTemplate = structuredClone(workflowTemplate);
  changedTemplate.checkpointTemplates[0]!.name = "Changed later";
  assert.equal(result.run.templateSnapshot.checkpointTemplates[0]?.name, "Contract completed");
});

test("workflow instantiation is idempotent per active project", async () => {
  const store = new MemoryWorkflowStore();
  const service = new WorkflowService(store, () => randomUUID(), () => workflowTimestamp);
  const first = await service.instantiate(
    ownerContext,
    workflowProject,
    workflowTemplate,
    "correlation-1",
  );
  const second = await service.instantiate(
    ownerContext,
    workflowProject,
    workflowTemplate,
    "correlation-2",
  );
  assert.equal(second.existing, true);
  assert.equal(second.run.id, first.run.id);
});
