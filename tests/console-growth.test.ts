import assert from "node:assert/strict";
import { test } from "node:test";
import { MANUAL_LEAD_STAGES, effectiveLeadStage, leadNeedsYou, normalizeEmail, pipelineSummary, type Lead } from "../features/console/pipeline";
import { isAtRisk, moveDirection, playFor, riskOrder } from "../features/console/lifecycle";
import type { ConsoleStudio } from "../features/console/model";
import { MANUAL_LEAD_STAGES as FUNCTION_STAGES } from "../functions/src/console/handlers/leads";

const NOW = Date.parse("2026-10-07T15:00:00Z");
const lead = (fields: Partial<Lead> = {}): Lead => ({ id: "l", name: "Sam", stage: "new", ...fields });

test("a lead follows its studio once it has one", () => {
  assert.equal(effectiveLeadStage(lead({ stage: "demo_booked" }), null), "demo_booked");
  assert.equal(effectiveLeadStage(lead({ tenantId: "t" }), { subscriptionStatus: "trialing", comped: false }), "trial");
  assert.equal(effectiveLeadStage(lead({ tenantId: "t" }), { subscriptionStatus: "incomplete", comped: false }), "trial");
  assert.equal(effectiveLeadStage(lead({ tenantId: "t" }), { subscriptionStatus: "active", comped: false }), "won");
  assert.equal(effectiveLeadStage(lead({ tenantId: "t" }), { subscriptionStatus: "cancelled", comped: false }), "lost");
});

test("a lead needs you when it's new, or its next step is due today or earlier", () => {
  assert.equal(leadNeedsYou(lead(), "new", NOW), "new");
  assert.equal(leadNeedsYou(lead({ stage: "contacted", nextStepAt: "2026-10-07" }), "contacted", NOW), "due");
  assert.equal(leadNeedsYou(lead({ stage: "contacted", nextStepAt: "2026-10-08" }), "contacted", NOW), null);
  assert.equal(leadNeedsYou(lead({ stage: "lost", nextStepAt: "2026-10-01" }), "lost", NOW), null);
});

test("the pipeline counts stages and the win rate of closed leads", () => {
  const summary = pipelineSummary(["new", "contacted", "won", "won", "lost", "trial"]);
  assert.equal(summary.open, 3);
  assert.equal(summary.winRate, 2 / 3);
  assert.equal(pipelineSummary([]).winRate, null);
  assert.equal(normalizeEmail("  Sam@Studio.COM "), "sam@studio.com");
  assert.equal(normalizeEmail("nope"), null);
  assert.deepEqual([...MANUAL_LEAD_STAGES], [...FUNCTION_STAGES]);
});

const studio = (fields: Partial<ConsoleStudio>): ConsoleStudio =>
  ({ lifecycle: "activated", comped: false, suspended: false, removed: false, trialEndsAt: null, lastPaymentFailedAt: null, health: { score: 90, band: "good", reasons: [] }, ...fields }) as ConsoleStudio;

test("at risk: stalled, at risk or a poor score, never comped or churned; payment trouble first", () => {
  assert.equal(isAtRisk(studio({ lifecycle: "stalled" })), true);
  assert.equal(isAtRisk(studio({ health: { score: 40, band: "poor", reasons: [] } })), true);
  assert.equal(isAtRisk(studio({ lifecycle: "at_risk", comped: true })), false);
  assert.equal(isAtRisk(studio({ lifecycle: "churned", health: { score: 10, band: "poor", reasons: [] } })), false);
  const failed = studio({ lastPaymentFailedAt: "2026-10-06T00:00:00Z", health: { score: 70, band: "fair", reasons: [] } });
  const low = studio({ health: { score: 20, band: "poor", reasons: [] } });
  assert.deepEqual([low, failed].sort(riskOrder(NOW)), [failed, low]);
});

test("a play answers the biggest thing costing a studio points", () => {
  const play = playFor(studio({ health: { score: 55, band: "fair", reasons: [{ key: "noActivity", label: "", points: 20 }, { key: "paymentFailed", label: "", points: 30 }] } }));
  assert.equal(play?.key, "paymentFailed");
  assert.equal(play?.tab, "billing");
  assert.equal(playFor(studio({})), null);
  assert.equal(moveDirection({ from: "setting_up", to: "activated" }), "up");
  assert.equal(moveDirection({ from: "paying", to: "at_risk" }), "down");
  assert.equal(moveDirection({ from: "at_risk", to: "paying" }), "up");
});

