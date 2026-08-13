import assert from "node:assert/strict";
import test from "node:test";
import { dailyCommandProjection } from "@/features/dashboard/daily-command-center";

test("daily command center separates decisions, exceptions, and active automation", () => {
  const projection = dailyCommandProjection({
    now: "2026-08-13T12:00:00.000Z",
    projects: [{ id: "project-1", name: "Smith Wedding" }],
    aiActions: [{
      id: "ai-1",
      projectId: "project-1",
      status: "review_required",
      title: "Approve consultation recap",
      updatedAt: "2026-08-13T11:00:00.000Z",
    }],
    deliveryDrafts: [{
      id: "delivery-1",
      projectId: "project-1",
      status: "review_required",
      receivedAt: "2026-08-13T10:00:00.000Z",
    }],
    tasks: [{
      id: "task-1",
      projectId: "project-1",
      status: "open",
      title: "Resolve missing venue",
      dueDate: "2026-08-12",
    }],
    bookingOrchestrations: [{
      id: "project-1",
      projectId: "project-1",
      status: "active",
      currentStep: "wait_for_signature",
      updatedAt: "2026-08-13T09:00:00.000Z",
    }],
    crewCascades: [{
      id: "crew-1",
      projectId: "project-1",
      status: "exhausted",
      role: "Second photographer",
      updatedAt: "2026-08-13T08:00:00.000Z",
    }],
  });

  assert.deepEqual(
    projection.approvals.map((item) => item.title),
    ["Approve consultation recap", "Approve gallery delivery"],
  );
  assert.equal(projection.exceptions.length, 2);
  assert.match(projection.exceptions[0]!.detail, /Smith Wedding/);
  assert.equal(projection.working[0]!.title, "Wait For Signature");
});

test("future-snoozed AI work and healthy completed work stay off the daily surface", () => {
  const projection = dailyCommandProjection({
    now: "2026-08-13T12:00:00.000Z",
    aiActions: [{
      id: "ai-1",
      status: "review_required",
      snoozedUntil: "2026-08-14T12:00:00.000Z",
    }],
    automationRuns: [{ id: "run-1", status: "succeeded" }],
    emailJobs: [{ id: "email-1", status: "delivered" }],
  });

  assert.deepEqual(projection, { approvals: [], exceptions: [], working: [] });
});
