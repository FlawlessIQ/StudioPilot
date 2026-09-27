import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  proposalTopic,
  proposalsToRetire,
  staleReason,
} from "../functions/src/ai/proposal-supersede";
import {
  preparedTopic,
  staleReason as pageStaleReason,
} from "../features/ai/prepared-groups";

const proposal = (
  id: string,
  title: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  title,
  projectId: "job-1",
  capability: "inquiry_reply_draft",
  status: "review_required",
  instructionVersion: "copilot_proposal_v1",
  structuredOutput: { recipientEmail: "couple@example.com", subject: "" },
  ...extra,
});

test("Cue and the job page agree on what a draft is about and when it's stale", () => {
  // functions/ duplicates the job page's rules; this keeps the copies in step.
  const titles = [
    "Remind the client about their overdue retainer payment.",
    "A gentle reminder about the deposit",
    "Review final invoice notice",
    "A warm nudge to complete their overdue planning questionnaire.",
    "Review schedule confirmation",
    "Staff the open second photographer role for the Smith Wedding.",
    "Your gallery is ready",
    "Thank them for the venue tour",
  ];
  for (const title of titles)
    assert.equal(
      proposalTopic({ title }),
      preparedTopic({ kind: "ai", record: { id: "x", title } }),
      title,
    );
  const states = ["LEAD", "RETAINER_PENDING", "BOOKED", "PLANNING", "DELIVERED", "CANCELLED", "ARCHIVED"];
  for (const topic of ["retainer", "questionnaire", null])
    for (const state of states)
      assert.equal(staleReason(topic, state), pageStaleReason(topic, state), `${topic} ${state}`);
});

test("a new draft retires Cue's earlier versions of it, and stale ones", () => {
  const pending = [
    proposal("old-retainer", "Remind the client about their overdue retainer payment."),
    proposal("old-questionnaire", "Remind the client to complete their overdue questionnaire."),
    proposal("old-task", "Create a task to follow up on the questionnaire", {
      capability: "studio_action",
      instructionVersion: "copilot_action_v1",
      structuredOutput: {},
    }),
    // Not Cue's: another part of StudioCue prepared it.
    proposal("other-retainer", "Retainer reminder", { instructionVersion: "message_draft_v1" }),
    // Already decided.
    proposal("done", "Remind the client to complete their questionnaire.", { status: "dismissed" }),
  ];
  const created = [proposal("new-questionnaire", "A warm nudge on the planning questionnaire")];

  // Before the retainer is paid: only the repeated questionnaire email goes.
  const unpaid = proposalsToRetire(pending, created, new Map([["job-1", "RETAINER_PENDING"]]));
  assert.deepEqual(unpaid.map((entry) => entry.id), ["old-questionnaire"]);
  assert.match(unpaid[0].note, /Replaced by a newer draft/);

  // Booked: the retainer reminder is out of date as well. A task on the same
  // subject is a different decision from the email, so it stays.
  const booked = proposalsToRetire(pending, created, new Map([["job-1", "BOOKED"]]));
  assert.deepEqual(booked.map((entry) => entry.id).sort(), ["old-questionnaire", "old-retainer"]);
  assert.match(booked.find((entry) => entry.id === "old-retainer")!.note, /already paid/);
});

test("Cue saves nothing stale and retires what it repeats, never sending anything", () => {
  const copilot = readFileSync("functions/src/ai/copilot.ts", "utf8");
  assert.match(copilot, /proposalActions\.filter\(stillCurrent\)/);
  assert.match(copilot, /for \(const entry of \[\.\.\.freshProposalActions, \.\.\.freshCommandActions\]\)/);
  assert.match(copilot, /for \(const retired of retiredProposals\)[\s\S]{0,120}status: "dismissed"/);
});
