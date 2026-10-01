import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { startOverConfirmText } from "@/features/proposals/workspace-guards";
import { proposalPdfAdjustments } from "../functions/src/proposals/pdf-adjustments";

// UAT run 2026-10-01 (docs/uat-gabe-feedback-2026-10-01.md), findings F1 + F2.

test("F1: the PDF adds the discount and tax rows that take its lines to its total", () => {
  assert.deepEqual(proposalPdfAdjustments({ discountCents: 30_000, taxCents: 0 }), [
    { description: "Discount", cents: -30_000 },
  ]);
  assert.deepEqual(proposalPdfAdjustments({ discountCents: 0, taxCents: 1_250 }), [
    { description: "Tax", cents: 1_250 },
  ]);
  assert.deepEqual(proposalPdfAdjustments({}), []);
  assert.deepEqual(proposalPdfAdjustments({ discountCents: "nonsense" }), []);
  // Lines $3,000 + $2,000 + $1,500 = $6,500, less $300 = the $6,200 total.
  const lines = [300_000, 200_000, 150_000];
  const rows = proposalPdfAdjustments({ discountCents: 30_000 });
  assert.equal(lines.reduce((a, b) => a + b, 0) + rows.reduce((a, r) => a + r.cents, 0), 620_000);
});

test("F1: the proposal PDF worker renders those rows", () => {
  const worker = readFileSync("functions/src/operations/ai-pdf.ts", "utf8");
  assert.match(worker, /proposalPdfAdjustments\(pricing\)/);
});

test("F2: starting over names only the packages that come off", () => {
  const onJob = [
    { packageId: "sign", name: "Signing test package" },
    { packageId: "video", name: "Test video package" },
  ];
  const kept = startOverConfirmText({ packageId: "sign", name: "Signing test package" }, onJob);
  assert.match(kept, /takes Test video package off the job/);
  assert.doesNotMatch(kept, /takes Signing test package/);

  const swapped = startOverConfirmText({ packageId: "gold", name: "Gold" }, onJob);
  assert.match(swapped, /takes Signing test package and Test video package off the job, with any extras and discount on them/);

  const same = startOverConfirmText({ packageId: "sign", name: "Signing test package" }, [onJob[0]!]);
  assert.doesNotMatch(same, /off the job/);
  assert.match(same, /extras and discount are cleared/);
});

test("T36: a second approval says 'nothing was sent again' only when the work was an email", async () => {
  const { decisionError } = await import("@/lib/ai/friendly-error");
  const refused = new Error("AI_ACTION_ALREADY_DECIDED");
  assert.match(decisionError(refused, { sends: true }), /nothing was sent again/);
  const task = decisionError(refused, { sends: false });
  assert.match(task, /^Already done/);
  assert.doesNotMatch(task, /sent/);
  // Any other refusal reads as it always did.
  assert.match(decisionError(new Error("AI_ACTION_NOT_APPROVED"), { sends: false }), /Approve this first/);
  const queue = readFileSync("components/ai/ai-approval-queue.tsx", "utf8");
  assert.match(queue, /decisionError\(caught, \{ sends: output\.outward === true \|\| approvingSends \}/);
});

test("T37: a stopped booking says why once, without repeating the job's name", async () => {
  const { todayInbox } = await import("@/features/today/inbox");
  const inbox = todayInbox({
    now: "2026-10-01T12:00:00.000Z",
    projects: [{ id: "p1", tenantId: "t", name: "Native signing test wedding", eventDate: "2027-06-12", state: "RETAINER_PENDING" }],
    bookingOrchestrations: [{ id: "p1", projectId: "p1", status: "needs_attention", blockers: ["eventDateAvailable"] }],
  } as never);
  const card = JSON.parse(JSON.stringify(inbox)).act.find((item: { id: string }) => item.id === "booking-p1");
  assert.equal(card.title, "Booking stopped for a reason");
  assert.equal(card.detail, "Stopped because the date clashes with another booking");
});

test("T14: the brief shows no confidence figure when it suggested no package", () => {
  const brief = readFileSync("components/booking/booking-autopilot-workspace.tsx", "utf8");
  assert.match(brief, /\{text\(recommendation\.packageId\) \? \(\s*<StatusBadge/);
  assert.match(brief, /No package suggested/);
});
