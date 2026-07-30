import assert from "node:assert/strict";
import test from "node:test";
import { summarizeReleaseEvidence } from "../features/operations/release-evidence";

test("release evidence uses verified measurements instead of activity estimates", () => {
  const summary = summarizeReleaseEvidence({
    productEvents: [
      {
        handling: {
          baselineSeconds: 3600,
          activeSeconds: 600,
          verifiedSecondsSaved: 3000,
          measurementMethod: "pilot_observation",
        },
      },
      {
        handling: {
          baselineSeconds: 1000,
          activeSeconds: 1,
          verifiedSecondsSaved: 999,
          measurementMethod: "owner_estimate",
        },
      },
    ],
    aiActions: [
      {
        status: "approved",
        authorityBoundary: "human_approval_required",
        decision: { action: "approved", editDelta: null },
      },
      {
        status: "executed",
        authorityBoundary: "draft_requires_review",
        decision: {
          action: "approved",
          editDelta: { subject: "Edited subject" },
        },
        validation: { issues: [] },
      },
    ],
    actionReceipts: [
      { status: "completed" },
      { status: "completed" },
      { status: "retry_scheduled" },
    ],
    automationRuns: [{ status: "completed" }],
    crewCascades: [
      {
        handlingStartedAt: "2026-07-29T12:00:00.000Z",
        handlingCompletedAt: "2026-07-29T12:09:00.000Z",
      },
    ],
    providerJobs: [{ status: "completed" }],
    incidents: [],
  });

  assert.equal(summary.verifiedMinutesSaved, 50);
  assert.equal(summary.ownerEstimatedMinutesSaved, 17);
  assert.equal(summary.ai.acceptanceRate, 100);
  assert.equal(summary.ai.editRate, 50);
  assert.equal(summary.automation.reliability, 100);
  assert.equal(summary.crew.medianMinutes, 9);
  assert.equal(summary.ready, true);
});

test("release evidence fails prohibited AI execution and open critical defects", () => {
  const summary = summarizeReleaseEvidence({
    productEvents: [],
    aiActions: [
      {
        status: "executed",
        authorityBoundary: "provider_evidence_required",
        decision: { action: "approved" },
      },
    ],
    actionReceipts: [{ status: "failed" }],
    automationRuns: [],
    crewCascades: [],
    providerJobs: [{ status: "dead_letter" }],
    incidents: [{ severity: "S1", status: "investigating" }],
  });

  assert.equal(summary.ai.authorityViolations, 1);
  assert.equal(summary.incidents.openCritical, 1);
  assert.equal(summary.automation.reliability, 0);
  assert.equal(summary.providers.health, "attention");
  assert.equal(summary.ready, false);
  assert.equal(
    summary.gates.find((gate) => gate.key === "authority_boundaries")?.status,
    "failed",
  );
});
