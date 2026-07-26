import assert from "node:assert/strict";
import test from "node:test";
import type { AutomationRun } from "@/features/automation/schema";
import {
  AutomationService,
  automationConditionsPass,
  type AutomationActionHandler,
  type AutomationRunStore,
} from "@/server/services/automation-service";
import type { AutomationRule } from "@/server/services/automation-types";
import { workflowTimestamp } from "./fixtures/workflow";

class MemoryAutomationStore implements AutomationRunStore {
  runs: AutomationRun[] = [];
  async findByIdempotencyKey(tenantId: string, key: string) {
    return this.runs.find(
      (run) => run.tenantId === tenantId && run.idempotencyKey === key,
    ) ?? null;
  }
  async create(run: AutomationRun) {
    this.runs.push(run);
  }
  async update(run: AutomationRun) {
    const index = this.runs.findIndex((candidate) => candidate.id === run.id);
    this.runs[index] = run;
  }
}

const rule: AutomationRule = {
  key: "booking-completed",
  name: "Booking completed",
  trigger: "project_status_changed",
  conditions: [{ field: "state", operator: "equals", value: "BOOKED" }],
  actions: [{
    key: "create-task",
    type: "create_task",
    configuration: { title: "Start planning" },
    requiresApproval: false,
  }],
  active: true,
};

test("automation condition evaluation is deterministic", () => {
  assert.equal(automationConditionsPass(rule, { state: "BOOKED" }), true);
  assert.equal(automationConditionsPass(rule, { state: "LEAD" }), false);
});

test("automation runs are idempotent and execute actions once", async () => {
  const store = new MemoryAutomationStore();
  let executions = 0;
  const handler: AutomationActionHandler = {
    async execute() {
      executions += 1;
      return { taskId: "task-1" };
    },
  };
  const service = new AutomationService(
    store,
    new Map([["create_task", handler]]),
    () => "automation-1",
    () => workflowTimestamp,
  );
  const input = {
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: "run-1",
    workflowVersion: 3,
    rule,
    idempotencyKey: "tenant-a|project-1|booking-completed",
    payload: { state: "BOOKED" },
  };
  const first = await service.execute(input);
  const second = await service.execute(input);
  assert.equal(first.status, "succeeded");
  assert.equal(second.id, first.id);
  assert.equal(executions, 1);
  assert.equal(store.runs.length, 1);
});
