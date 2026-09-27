import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { groupPrepared, preparedTopic, staleReason } from "../features/ai/prepared-groups";

const draft = (id: string, title: string, at: string, capability = "inquiry_reply_draft") => ({
  kind: "ai" as const,
  record: {
    id,
    title,
    capability,
    createdAt: at,
    structuredOutput: { recipientEmail: "couple@example.com", subject: "" },
  },
});

test("versions of the same reminder fold into one decision, newest first", () => {
  // Worded differently each time Cue was asked — the real titles from the job.
  const groups = groupPrepared([
    draft("a", "Remind the client about their overdue retainer payment.", "2026-09-09T10:00:00Z"),
    draft("b", "A gentle reminder to the client about their overdue retainer payment.", "2026-09-09T11:00:00Z"),
    draft("c", "Send a reminder to the client for their overdue retainer payment.", "2026-09-15T10:00:00Z"),
    draft("d", "Remind the client to complete their overdue questionnaire.", "2026-09-09T12:00:00Z"),
    draft("e", "Create a task to follow up on the overdue retainer", "2026-09-13T10:00:00Z", "studio_action"),
  ]);
  const retainerDrafts = groups.find((group) => group.lead.record.id === "c");
  assert.ok(retainerDrafts);
  assert.deepEqual(retainerDrafts.entries.map((entry) => entry.record.id), ["c", "b", "a"]);
  // A task is a different decision from an email, even on the same subject.
  assert.equal(groups.length, 3);
  assert.equal(groups[0].lead.record.id, "c");
});

test("unrelated drafts without a known subject stay apart", () => {
  const groups = groupPrepared([
    draft("x", "Thank them for the venue tour", "2026-09-01T00:00:00Z"),
    draft("y", "Ask about parking at the ceremony", "2026-09-02T00:00:00Z"),
  ]);
  assert.equal(groups.length, 2);
});

test("a retainer reminder on a booked job is out of date", () => {
  assert.equal(preparedTopic(draft("r", "Quick reminder on your wedding retainer", "")), "retainer");
  assert.match(staleReason("retainer", "BOOKED") ?? "", /already paid/);
  assert.match(staleReason("retainer", "PLANNING") ?? "", /already paid/);
  assert.equal(staleReason("retainer", "RETAINER_PENDING"), null);
  assert.equal(staleReason("questionnaire", "BOOKED"), null);
  assert.match(staleReason(null, "CANCELLED") ?? "", /no longer going ahead/);
});

test("the job page shows compact rows at every width, not a card per draft", () => {
  const tray = readFileSync("components/projects/project-prepared-tray.tsx", "utf8");
  assert.doesNotMatch(tray, /isPhone|useIsPhone/);
  assert.doesNotMatch(tray, /project-prepared-list/);
  assert.match(tray, /groupPrepared\(items\)/);
});
