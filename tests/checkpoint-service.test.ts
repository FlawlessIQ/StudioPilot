import assert from "node:assert/strict";
import test from "node:test";
import type { AuditEvent } from "@/features/audit/schema";
import type { Checkpoint } from "@/features/checkpoints/schema";
import {
  CheckpointService,
  type CheckpointMutationStore,
} from "@/server/services/checkpoint-service";
import { checkpointFixture, workflowTimestamp } from "./fixtures/workflow";

class MemoryCheckpointStore implements CheckpointMutationStore {
  audit: AuditEvent | null = null;

  constructor(readonly checkpoints: Checkpoint[]) {}

  async getById(tenantId: string, checkpointId: string) {
    return this.checkpoints.find(
      (checkpoint) => checkpoint.tenantId === tenantId && checkpoint.id === checkpointId,
    ) ?? null;
  }

  async getMany(tenantId: string, checkpointIds: readonly string[]) {
    return this.checkpoints.filter(
      (checkpoint) => checkpoint.tenantId === tenantId && checkpointIds.includes(checkpoint.id),
    );
  }

  async update(checkpoint: Checkpoint, audit: AuditEvent) {
    const index = this.checkpoints.findIndex((candidate) => candidate.id === checkpoint.id);
    this.checkpoints[index] = checkpoint;
    this.audit = audit;
  }
}

const owner = {
  userId: "owner",
  tenantId: "tenant-a",
  membershipTenantId: "tenant-a",
  role: "studio_owner" as const,
};
const coordinator = {
  ...owner,
  userId: "coordinator",
  role: "studio_coordinator" as const,
  allowedProjectIds: ["project-1"],
};

test("checkpoint completion requires evidence and completed dependencies", async () => {
  const dependency = checkpointFixture({ id: "dependency", status: "ready" });
  const target = checkpointFixture({
    id: "target",
    dependencyIds: ["dependency"],
  });
  const service = new CheckpointService(
    new MemoryCheckpointStore([dependency, target]),
    () => "audit-1",
    () => workflowTimestamp,
  );
  await assert.rejects(
    service.complete(coordinator, "target", [], null, "correlation"),
    /dependencies/i,
  );
  dependency.status = "complete";
  await assert.rejects(
    service.complete(coordinator, "target", [], null, "correlation"),
    /evidence/i,
  );
});

test("only permitted users can waive and a reason is mandatory", async () => {
  const checkpoint = checkpointFixture();
  const store = new MemoryCheckpointStore([checkpoint]);
  const service = new CheckpointService(
    store,
    () => "audit-1",
    () => workflowTimestamp,
  );
  await assert.rejects(
    service.waive(coordinator, checkpoint.id, "Valid operational reason", null, "correlation"),
  );
  await assert.rejects(
    service.waive(owner, checkpoint.id, "short", null, "correlation"),
    /reason/i,
  );
  const waived = await service.waive(
    owner,
    checkpoint.id,
    "Venue removed this requirement in writing.",
    null,
    "correlation",
  );
  assert.equal(waived.status, "waived");
  assert.equal(store.audit?.action, "checkpoint.waived");
});
