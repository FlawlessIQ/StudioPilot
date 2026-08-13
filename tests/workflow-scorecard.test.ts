import assert from "node:assert/strict";
import test from "node:test";
import {
  workflowCapabilityRegistry,
  workflowScorecard,
} from "../features/operations/workflow-scorecard";

test("workflow scorecard covers the canonical 44 capabilities", () => {
  assert.equal(workflowCapabilityRegistry.length, 44);
  assert.equal(new Set(workflowCapabilityRegistry.map((item) => item.id)).size, 44);
  const score = workflowScorecard({
    productEvents: [],
    aiActions: [],
    actionReceipts: [],
    automationRuns: [],
    providerJobs: [],
    emailJobs: [],
  });
  assert.equal(score.coverage.score, 95);
  assert.equal(score.automation.score, null);
  assert.equal(score.approvalLed.score, null);
});

test("automation and approval-led scores use observed work rather than estimates", () => {
  const event = (
    executionMode: string,
    humanRole: string,
    seconds = 0,
  ) => ({
    properties: { workflowStep: true, executionMode, humanRole },
    handling: seconds
      ? {
          measurementMethod: "workflow_timestamps",
          verifiedSecondsSaved: seconds,
        }
      : null,
  });
  const score = workflowScorecard({
    productEvents: [
      event("automatic", "none", 600),
      event("ai_prepared", "approval", 300),
      event("manual", "data_entry"),
      event("manual", "exception"),
    ],
    aiActions: [
      { status: "approved", decision: { editDelta: { body: "Changed" } } },
    ],
    actionReceipts: [{ status: "completed" }],
    automationRuns: [{ status: "failed" }],
    providerJobs: [{ status: "succeeded" }],
    emailJobs: [{ status: "succeeded" }],
  });
  assert.equal(score.automation.score, 50);
  assert.equal(score.approvalLed.score, 67);
  assert.equal(score.quality.aiEditRate, 100);
  assert.equal(score.quality.reliability, 75);
  assert.equal(score.quality.verifiedMinutesSaved, 15);
});
