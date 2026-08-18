import assert from "node:assert/strict";
import test from "node:test";
import { demoTenantDocuments } from "../features/live/demo-records.ts";
import { dailyCommandProjection } from "../features/dashboard/daily-command-center.ts";

/**
 * Guards the demo fixtures that make the AI surfaces observable.
 *
 * Before these existed, `demoTenantDocuments` returned [] for every collection
 * feeding an approval or an in-flight job, so the AI control centre rendered
 * 0/0/0 and every "prepared for you" tray was empty. That looked like broken
 * features but was only missing fixtures — and it made the AI panels
 * impossible to review or verify locally.
 *
 * These tests run the real mapping through the real projection, so a renamed
 * field in either layer fails here rather than silently emptying a panel.
 */

const projection = () =>
  dailyCommandProjection({
    now: new Date().toISOString(),
    projects: demoTenantDocuments("projects"),
    tasks: demoTenantDocuments("tasks"),
    aiActions: demoTenantDocuments("aiActions"),
    automationApprovals: demoTenantDocuments("automationApprovals"),
    communicationDrafts: demoTenantDocuments("communicationDrafts"),
    deliveryDrafts: demoTenantDocuments("deliveryDrafts"),
    proposals: demoTenantDocuments("proposals"),
    automationRuns: demoTenantDocuments("automationRuns"),
    providerJobs: demoTenantDocuments("providerJobs"),
    emailJobs: demoTenantDocuments("emailJobs"),
    integrationConnections: demoTenantDocuments("integrationConnections"),
    bookingOrchestrations: demoTenantDocuments("bookingOrchestrations"),
    crewCascades: demoTenantDocuments("crewCascades"),
    invoiceReferences: demoTenantDocuments("invoiceReferences"),
  });

test("every collection that feeds an AI surface has demo records", () => {
  for (const name of [
    "aiActions",
    "actionReceipts",
    "automationApprovals",
    "communicationDrafts",
    "deliveryDrafts",
    "bookingOrchestrations",
    "crewCascades",
    "tasks",
  ]) {
    assert.ok(
      demoTenantDocuments(name).length > 0,
      `${name} has no demo records, so its surface renders empty`,
    );
  }
});

test("the approvals bucket is populated", () => {
  const { approvals } = projection();
  assert.ok(approvals.length >= 3, `expected 3+ approvals, got ${approvals.length}`);
  // An AI draft and a prepared email are distinct sources; both must arrive.
  assert.ok(approvals.some((item) => item.id.startsWith("ai-")), "no aiActions approval");
  assert.ok(
    approvals.some((item) => item.id.startsWith("message-")),
    "no communicationDrafts approval",
  );
  assert.ok(
    approvals.some((item) => item.id.startsWith("automation-approval-")),
    "no automationApprovals approval",
  );
});

test("the working bucket is populated — this is the AI-in-motion feed", () => {
  const { working } = projection();
  assert.ok(working.length >= 2, `expected 2+ in-flight items, got ${working.length}`);
  assert.ok(
    working.some((item) => item.id.startsWith("crew-")),
    "no active crew cascade",
  );
  assert.ok(
    working.some((item) => item.id.startsWith("booking-")),
    "no active booking orchestration",
  );
});

test("the exceptions bucket surfaces overdue work", () => {
  const { exceptions } = projection();
  assert.ok(exceptions.length >= 2, `expected 2+ exceptions, got ${exceptions.length}`);
  assert.ok(
    exceptions.some((item) => item.id.startsWith("task-")),
    "no overdue task exception",
  );
  assert.ok(
    exceptions.some((item) => item.id.startsWith("crew-search-")),
    "no exhausted crew search exception",
  );
});

test("AI actions carry the fields the review card renders", () => {
  const actions = demoTenantDocuments("aiActions");
  for (const action of actions) {
    for (const field of [
      "capability",
      "title",
      "status",
      "authorityBoundary",
      "confidence",
      "validation",
      "sourceReferences",
      "structuredOutput",
      "projectId",
    ]) {
      assert.ok(field in action, `aiAction ${action.id} is missing ${field}`);
    }
    assert.ok(
      Array.isArray(action.sourceReferences) &&
        (action.sourceReferences as unknown[]).length > 0,
      `aiAction ${action.id} must cite at least one source`,
    );
  }
});

test("a message draft and a structured draft both exist, so both editors are reachable", () => {
  const actions = demoTenantDocuments("aiActions");
  const isMessage = (action: Record<string, unknown>) => {
    const output = action.structuredOutput as Record<string, unknown>;
    return typeof output?.subject === "string" && typeof output?.body === "string";
  };
  assert.ok(actions.some(isMessage), "no message draft — subject/body editor unreachable");
  assert.ok(
    actions.some((action) => !isMessage(action)),
    "no structured draft — structured-field editor unreachable",
  );
});

test("the inquiry reply can reach the approve-then-send path", () => {
  const reply = demoTenantDocuments("aiActions").find(
    (action) => action.capability === "inquiry_reply_draft",
  );
  assert.ok(reply, "no inquiry_reply_draft action");
  const output = reply.structuredOutput as Record<string, unknown>;
  assert.equal(
    typeof output.recipientEmail,
    "string",
    "inquiry reply needs recipientEmail or the send path never unlocks",
  );
});
