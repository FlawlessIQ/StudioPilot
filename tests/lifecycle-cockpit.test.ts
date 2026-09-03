import assert from "node:assert/strict";
import test from "node:test";
import {
  actionReceiptSchema,
  aiActionVisibleInQueue,
} from "@/features/ai-actions/schema";
import { projectLifecycleProjection } from "@/features/projects/lifecycle-projection";
import { noReadinessEvidence } from "@/features/readiness/checkpoint-evidence";

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

test("work the records already prove is not listed as outstanding", () => {
  /**
   * The reference panel decided from `checkpoint.status` alone, and checkpoints
   * are only ever written by workflow automation — so a job whose contract was
   * completed and whose retainer was paid minutes earlier listed both as
   * outstanding, owed by the client, directly beneath a journey rail reading
   * "BOOKING 3/3". The header on the same screen was already evidence-aware,
   * so the two disagreed: 8 blockers counted, 12 listed.
   */
  const checkpoints = [
    {
      id: "cp-contract",
      projectId: "project-1",
      templateKey: "contract-completed",
      completionMethod: "contract_completed",
      name: "Contract completed",
      ownerType: "client",
      status: "ready",
      blocking: true,
      resolvedDueDate: "2027-02-12",
    },
    {
      id: "cp-venue",
      projectId: "project-1",
      templateKey: "venue-confirmed",
      completionMethod: "manual",
      name: "Venue confirmed",
      ownerType: "studio",
      status: "not_started",
      blocking: true,
      resolvedDueDate: "2027-05-13",
    },
  ];
  const project = { id: "project-1", state: "BOOKED" };

  const blind = projectLifecycleProjection({ project, checkpoints });
  assert.ok(
    blind.lanes.client.some((item) => item.label === "Contract completed"),
    "without evidence the contract is still listed, as before",
  );

  const informed = projectLifecycleProjection({
    project,
    checkpoints,
    evidence: { ...noReadinessEvidence, contractCompleted: true },
  });
  assert.equal(
    informed.lanes.client.filter(
      (item) => item.label === "Contract completed",
    ).length,
    0,
  );
  // A manual judgement is never inferred, so it stays — and stays the
  // studio's.
  assert.ok(
    informed.lanes.studio.some((item) => item.label === "Venue confirmed"),
  );
});

test("a blocking checkpoint says what it waits for, not that it blocks", () => {
  // Twelve entries across three lanes all read "Blocks event readiness until
  // resolved." — no information after the first, and it crowded out the part
  // that differs. `status` already marks the blocking ones.
  const projection = projectLifecycleProjection({
    project: { id: "project-1", state: "BOOKED" },
    checkpoints: [
      {
        id: "cp-form",
        projectId: "project-1",
        templateKey: "questionnaire-complete",
        completionMethod: "form_submitted",
        name: "Questionnaire complete",
        ownerType: "client",
        status: "not_started",
        blocking: true,
        resolvedDueDate: "2027-04-28",
      },
      {
        id: "cp-venue",
        projectId: "project-1",
        templateKey: "venue-confirmed",
        completionMethod: "manual",
        name: "Venue confirmed",
        ownerType: "studio",
        status: "not_started",
        blocking: true,
        resolvedDueDate: "2027-05-13",
      },
    ],
  });
  const details = [
    ...projection.lanes.client,
    ...projection.lanes.studio,
  ].map((item) => item.detail);
  for (const detail of details)
    assert.doesNotMatch(detail, /Blocks event readiness until resolved/);
  assert.ok(
    details.some((detail) => /submits the form/.test(detail)),
    "a record-backed one says which record",
  );
  assert.ok(
    details.some((detail) => /judgement/.test(detail)),
    "a manual one says it is the studio's call",
  );
});

test("one obligation is one row, even when a checkpoint and a record describe it", () => {
  /**
   * The panel used to list both. "Completes when the couple submits the form
   * with answers" (the `questionnaire-complete` checkpoint) sat directly above
   * "Finish planning questionnaire · 0% complete" (the response record) —
   * same person, same due date, same obligation. Four pairs do this:
   * questionnaire, contract, unpaid invoices and crew acknowledgement. It
   * became more visible once evidence stopped listing finished work, which
   * left the panel four rows shorter and the duplicates adjacent.
   *
   * The record row wins because it is the specific one — it carries the
   * percentage, the balance, the signer count.
   */
  const projection = projectLifecycleProjection({
    now,
    project: { id: "p1", state: "BOOKED", eventDate: "2027-06-12" },
    evidence: noReadinessEvidence,
    checkpoints: [
      {
        id: "k1",
        projectId: "p1",
        archivedAt: null,
        templateKey: "questionnaire-complete",
        name: "Questionnaire complete",
        ownerType: "client",
        blocking: true,
        status: "not_started",
        completionMethod: "form_submitted",
        resolvedDueDate: "2027-04-28",
      },
      {
        id: "k2",
        projectId: "p1",
        archivedAt: null,
        templateKey: "venue-confirmed",
        name: "Venue confirmed",
        ownerType: "studio",
        blocking: true,
        status: "not_started",
        completionMethod: "manual",
        resolvedDueDate: "2027-05-13",
      },
    ],
    questionnaires: [
      {
        id: "q1",
        projectId: "p1",
        status: "assigned",
        completionPercent: 0,
        resolvedDueDate: "2027-04-28",
      },
    ],
  });

  const labels = [
    ...projection.lanes.client,
    ...projection.lanes.studio,
  ].map((work) => work.label);

  assert.deepEqual(
    labels.filter((label) => /questionnaire/i.test(label)),
    ["Finish planning questionnaire"],
    "the questionnaire should appear once, as the record row",
  );
  // A checkpoint with no record equivalent still has to be listed.
  assert.ok(
    labels.includes("Venue confirmed"),
    "a checkpoint nothing else describes must survive the dedupe",
  );
});

test("a checkpoint with no record of its own is still listed", () => {
  /**
   * The other half of the dedupe: suppressing a checkpoint because a record
   * *could* exist would hide the obligation on a job where the studio has not
   * sent the form yet, which is exactly when they need telling.
   */
  const projection = projectLifecycleProjection({
    now,
    project: { id: "p1", state: "BOOKED", eventDate: "2027-06-12" },
    evidence: noReadinessEvidence,
    checkpoints: [
      {
        id: "k1",
        projectId: "p1",
        archivedAt: null,
        templateKey: "questionnaire-complete",
        name: "Questionnaire complete",
        ownerType: "client",
        blocking: true,
        status: "not_started",
        completionMethod: "form_submitted",
        resolvedDueDate: "2027-04-28",
      },
    ],
    questionnaires: [],
  });

  assert.deepEqual(
    projection.lanes.client.map((work) => work.label),
    ["Questionnaire complete"],
  );
});
