import assert from "node:assert/strict";
import { test } from "node:test";
import { aiActionSchema } from "@/features/ai-actions/schema";

/**
 * The copilot writes aiAction documents directly (Admin SDK, unvalidated on
 * write), and the browser reads them back through aiActionSchema. These tests
 * pin the exact shapes the copilot produces so a schema change can't silently
 * make its cards fail client validation and vanish — the three gotchas hit while
 * building this: the studio_action capability must exist, downstreamCommand
 * commandId must be non-empty, and the email-draft shape stays valid.
 */
const now = new Date().toISOString();

const auditFields = {
  createdAt: now,
  updatedAt: now,
  createdBy: "user_1",
  updatedBy: "user_1",
};

const base = {
  id: "ai_1",
  tenantId: "t1",
  projectId: "p1",
  actorId: "user_1",
  modelProvider: "vertex_ai",
  modelVersion: "gemini-2.5-pro",
  instructionVersion: "copilot_action_v1",
  outputSchemaVersion: "copilot_action_output_v1",
  sourceReferences: [
    { entityType: "project", entityId: "p1", versionId: null, label: "Smith Wedding", locator: null },
  ],
  confidence: { overall: 0.7, label: "medium", uncertainFields: [] },
  validation: { status: "passed", issues: [] },
  decision: null,
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostMicros: 0,
    latencyMs: 0,
    estimatedMinutesSaved: 5,
  },
  failure: null,
  snoozedUntil: null,
  archivedAt: null,
  ...auditFields,
};

const studioCommandAction = {
  ...base,
  title: "Chase overdue retainer",
  capability: "studio_action",
  authorityBoundary: "human_approval_required",
  status: "review_required",
  structuredOutput: {
    kind: "studio_command",
    commandType: "create_task",
    label: "Create a task on Smith Wedding",
    detail: "Chase overdue retainer",
    rationale: "The retainer is overdue.",
    outward: false,
    sendsTo: null,
    command: { domain: "workflow", op: "createTask", input: { projectId: "p1" } },
  },
  downstreamCommand: { commandType: "create_task", commandId: "pending", executedAt: null },
};

const emailDraftAction = {
  ...base,
  title: "Payment reminder",
  capability: "inquiry_reply_draft",
  authorityBoundary: "draft_requires_review",
  status: "review_required",
  structuredOutput: {
    subject: "Friendly reminder",
    body: "Hi,",
    recipientEmail: "client@example.com",
    recipientName: "John Smith",
    projectName: "Smith Wedding",
    contactId: "c1",
    purpose: "payment_reminder",
  },
  downstreamCommand: null,
};

test("a proposed studio-command action validates against aiActionSchema", () => {
  assert.doesNotThrow(() => aiActionSchema.parse(studioCommandAction));
});

test("a proposed email-draft action validates against aiActionSchema", () => {
  assert.doesNotThrow(() => aiActionSchema.parse(emailDraftAction));
});

test("an empty downstreamCommand commandId is rejected (why 'pending' is used)", () => {
  const bad = {
    ...studioCommandAction,
    downstreamCommand: { commandType: "create_task", commandId: "", executedAt: null },
  };
  assert.throws(() => aiActionSchema.parse(bad));
});

test("an unknown capability is rejected (why studio_action was added to the enum)", () => {
  const bad = { ...studioCommandAction, capability: "not_a_real_capability" };
  assert.throws(() => aiActionSchema.parse(bad));
});
