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

/**
 * The handling-time gate must not clear itself.
 *
 * `docs/acceptance-pilot.md` singles this one out: "Every other gate is
 * produced as a side effect of doing the walk. Verified time-reduction is not
 * — it needs an explicit measurement of at least one real task." And: "Amber is
 * never cleared by editing data."
 *
 * Rehearsing the pilot against a real tenant on 2026-09-22, it was already
 * green, reporting "0 verified minutes saved." as a pass. `Number(null)` is 0
 * and `Number.isFinite(0)` is true, so an absent measurement became a recorded
 * zero — and the crew cascade emits `lifecycle.crew_staffed` carrying
 * `measurementMethod: "workflow_timestamps"` with `verifiedSecondsSaved: null`.
 * Staffing anybody cleared the gate that exists to prove a human measured
 * something.
 */

const handlingEvent = (handling: Record<string, unknown>) => ({
  id: "e1",
  handling,
});

const emptyInput = {
  productEvents: [],
  aiActions: [],
  actionReceipts: [],
  automationRuns: [],
  crewCascades: [],
  providerJobs: [],
  incidents: [],
};

const timeGate = (productEvents: Array<Record<string, unknown>>) =>
  summarizeReleaseEvidence({
    ...emptyInput,
    productEvents,
  } as never).gates.find((gate) => gate.key === "verified_time_reduction");

test("an absent measurement does not count as a verified zero", () => {
  const gate = timeGate([
    handlingEvent({
      activeSeconds: 7503,
      baselineSeconds: null,
      verifiedSecondsSaved: null,
      measurementMethod: "workflow_timestamps",
    }),
  ]);
  assert.equal(
    gate?.status,
    "needs_evidence",
    "this is the exact shape the crew cascade emits on every staffing",
  );
});

test("a measured saving of zero is not a reduction", () => {
  const gate = timeGate([
    handlingEvent({
      verifiedSecondsSaved: 0,
      measurementMethod: "pilot_observation",
    }),
  ]);
  assert.equal(gate?.status, "needs_evidence");
});

test("a real measured saving still passes", () => {
  const gate = timeGate([
    handlingEvent({
      verifiedSecondsSaved: 900,
      measurementMethod: "pilot_observation",
    }),
  ]);
  assert.equal(gate?.status, "passed");
  assert.match(String(gate?.evidence), /15 verified minutes saved/);
});

test("an owner estimate still cannot clear the gate", () => {
  const gate = timeGate([
    handlingEvent({
      verifiedSecondsSaved: 900,
      measurementMethod: "owner_estimate",
    }),
  ]);
  assert.equal(gate?.status, "needs_evidence");
});
