import assert from "node:assert/strict";
import test from "node:test";
import {
  actionReceiptSchema,
  aiActionVisibleInQueue,
} from "@/features/ai-actions/schema";
import { projectLifecycleProjection } from "@/features/projects/lifecycle-projection";

const now = "2026-07-29T20:00:00.000Z";

test("lifecycle cockpit separates StudioCue, studio, client, and crew work", () => {
  const projection = projectLifecycleProjection({
    now,
    project: {
      id: "project-1",
      state: "PLANNING",
      readinessScore: 72,
      nextAction: "Confirm final schedule",
    },
    automationRuns: [
      {
        id: "run-1",
        name: "Questionnaire follow-up",
        status: "running",
      },
    ],
    checkpoints: [
      {
        id: "checkpoint-1",
        name: "Approve schedule",
        ownerType: "studio",
        status: "in_progress",
        blocking: true,
        resolvedDueDate: "2026-07-28",
      },
    ],
    questionnaires: [
      {
        id: "response-1",
        status: "in_progress",
        completionPercent: 70,
        dueDate: "2026-08-01",
      },
    ],
    crewAssignments: [
      {
        id: "assignment-1",
        status: "accepted",
        role: "Second photographer",
        currentScheduleVersion: 3,
        acknowledgedScheduleVersion: 2,
      },
    ],
  });

  assert.equal(projection.currentStage, "Planning");
  assert.equal(projection.lanes.studiocue.length, 1);
  assert.equal(projection.lanes.studio[0]?.status, "blocked");
  assert.equal(projection.lanes.client.length, 1);
  assert.equal(projection.lanes.crew.length, 1);
  assert.equal(projection.primaryBlocker, "Approve schedule");
  assert.equal(projection.nextAction.owner, "Studio");
});

test("AI queue hides future snoozes and receipts preserve operational controls", () => {
  assert.equal(
    aiActionVisibleInQueue(
      {
        status: "review_required",
        snoozedUntil: "2026-07-30T20:00:00.000Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    aiActionVisibleInQueue(
      {
        status: "review_required",
        snoozedUntil: "2026-07-28T20:00:00.000Z",
      },
      now,
    ),
    true,
  );

  const receipt = actionReceiptSchema.safeParse({
    id: "receipt-1",
    tenantId: "tenant-1",
    projectId: "project-1",
    title: "Approved schedule draft",
    summary: "Saved the approved draft. No provider action was executed.",
    status: "completed",
    source: "ai_approval_queue",
    affectedEntityType: "aiAction",
    affectedEntityId: "action-1",
    providerEvidence: null,
    reversible: false,
    retryable: false,
    canCancel: false,
    canRetry: false,
    attempts: 1,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "owner-1",
    updatedBy: "owner-1",
    archivedAt: null,
  });
  assert.equal(receipt.success, true);
});
