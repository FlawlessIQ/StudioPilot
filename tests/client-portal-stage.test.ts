import assert from "node:assert/strict";
import { test } from "node:test";
import {
  portalPastNotice,
  portalStageIsBehind,
  type PortalArea,
} from "@/features/client/portal-stage";
import { buildClientMilestones } from "@/server/client/portal-experience";

/**
 * The client portal's empty states were all written for a couple who had just
 * arrived. Thirteen days after Maya's wedding hers said "Your studio is still
 * preparing your proposal", "Your agreement will appear after the studio sends
 * it for signature", and "A review request may appear after your gallery is
 * delivered" — three promises about a future that had gone by.
 */
const AREAS: PortalArea[] = [
  "proposal",
  "contract",
  "questionnaire",
  "schedule",
  "delivery",
  "reviews",
];

test("a brand-new inquiry has nothing behind it", () => {
  const lead = buildClientMilestones("LEAD");
  for (const area of AREAS) {
    assert.equal(portalStageIsBehind(lead, area), false, area);
  }
});

test("a shot wedding has booking, planning and the event behind it", () => {
  const shot = buildClientMilestones("EVENT_COMPLETE");
  assert.equal(portalStageIsBehind(shot, "proposal"), true);
  assert.equal(portalStageIsBehind(shot, "contract"), true);
  assert.equal(portalStageIsBehind(shot, "questionnaire"), true);
  assert.equal(portalStageIsBehind(shot, "schedule"), true);
  // Delivery has not happened, so its area is still ahead of them.
  assert.equal(portalStageIsBehind(shot, "delivery"), false);
  assert.equal(portalStageIsBehind(shot, "reviews"), false);
});

test("a delivered job has its gallery and review areas behind it too", () => {
  const closed = buildClientMilestones("CLOSED");
  for (const area of AREAS) {
    assert.equal(portalStageIsBehind(closed, area), true, area);
  }
});

test("a booked job is past booking but not past planning", () => {
  const booked = buildClientMilestones("BOOKED");
  assert.equal(portalStageIsBehind(booked, "contract"), true);
  assert.equal(portalStageIsBehind(booked, "questionnaire"), false);
  assert.equal(portalStageIsBehind(booked, "schedule"), false);
});

test("missing milestones never claim a stage is behind them", () => {
  for (const area of AREAS) {
    assert.equal(portalStageIsBehind(null, area), false, area);
    assert.equal(portalStageIsBehind([], area), false, area);
  }
});

test("every area has a past-tense sentence, and none of them promises a future", () => {
  for (const area of AREAS) {
    const notice = portalPastNotice(area);
    assert.ok(notice.title.length > 0, area);
    assert.ok(notice.detail.length > 20, area);
    assert.doesNotMatch(notice.detail, /will appear|still preparing|may appear/, area);
  }
});
