import assert from "node:assert/strict";
import test from "node:test";
import { calculateReadiness } from "@/features/readiness/engine";
import { checkpointFixture, workflowTimestamp } from "./fixtures/workflow";

test("a project is not ready while a blocking checkpoint remains", () => {
  const assessment = calculateReadiness({
    id: "project-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: "run-1",
    checkpoints: [
      checkpointFixture({ id: "complete", status: "complete" }),
      checkpointFixture({ id: "blocked", name: "Final schedule approved", status: "ready" }),
      checkpointFixture({ id: "nonblocking", blocking: false, status: "not_started" }),
    ],
    calculatedAt: workflowTimestamp,
  });

  assert.equal(assessment.ready, false);
  assert.equal(assessment.score, 50);
  assert.equal(assessment.blockingItems.length, 1);
  assert.equal(assessment.recommendedNextAction, "Final schedule approved · client");
});

test("active waivers satisfy a blocker but expired waivers do not", () => {
  const active = calculateReadiness({
    id: "project-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: "run-1",
    checkpoints: [
      checkpointFixture({
        status: "waived",
        waiverReason: "Owner approved operational exception.",
        waiverExpiresAt: "2026-07-27T12:00:00.000Z",
      }),
    ],
    calculatedAt: workflowTimestamp,
  });
  const expired = calculateReadiness({
    id: "project-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: "run-1",
    checkpoints: [
      checkpointFixture({
        status: "waived",
        waiverReason: "Owner approved temporary exception.",
        waiverExpiresAt: "2026-07-25T12:00:00.000Z",
      }),
    ],
    calculatedAt: workflowTimestamp,
  });
  assert.equal(active.ready, true);
  assert.equal(expired.ready, false);
  assert.equal(expired.blockingItems[0]?.reason, "Waiver expired");
});

test("overdue and at-risk items are deterministic date projections", () => {
  const assessment = calculateReadiness({
    id: "project-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: "run-1",
    checkpoints: [
      checkpointFixture({ id: "late", resolvedDueDate: "2026-07-25" }),
      checkpointFixture({ id: "soon", resolvedDueDate: "2026-07-30" }),
    ],
    calculatedAt: workflowTimestamp,
  });
  assert.equal(assessment.overdueItems.length, 1);
  assert.equal(assessment.atRiskItems.length, 1);
});

test("a project with no configured blocking checkpoints is not ready", () => {
  const assessment = calculateReadiness({
    id: "project-1",
    tenantId: "tenant-a",
    projectId: "project-1",
    workflowRunId: null,
    checkpoints: [],
    calculatedAt: workflowTimestamp,
  });

  assert.equal(assessment.ready, false);
  assert.equal(assessment.score, 0);
  assert.equal(
    assessment.recommendedNextAction,
    "Set up required readiness checkpoints",
  );
});
