import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PROPOSAL_FOLLOW_UP_DAYS,
  proposalFollowUpActionId,
  proposalFollowUpCopy,
  proposalFollowUpDue,
  proposalStillOpen,
  type PriorFollowUp,
} from "../functions/src/booking/proposal-follow-ups.ts";
import { todayInbox, type TodayInput } from "@/features/today/inbox";

/**
 * Proposal follow-ups (docs/positioning-office-manager-plan-2026-10-06.md,
 * phase 5): Cue drafts a note on day 3 and day 7 after a proposal goes out,
 * the studio sends it with one tap, and an answered proposal is never chased.
 */

const read = (path: string) => readFileSync(path, "utf8");
const proposal = { status: "sent", sentAt: "2026-10-01T15:00:00.000Z", expiresAt: "2026-10-31T00:00:00.000Z" };
const on = (day: string) => `${day}T14:00:00.000Z`;
const due = (overrides: Partial<Parameters<typeof proposalFollowUpDue>[0]> = {}) =>
  proposalFollowUpDue({ proposal, lastInboundAt: null, prior: [], now: on("2026-10-04"), ...overrides });

test("day 3, then day 7, counted in days from when it went out", () => {
  assert.deepEqual([...PROPOSAL_FOLLOW_UP_DAYS], [3, 7]);
  assert.equal(due({ now: on("2026-10-03") }), null, "two days");
  assert.equal(due(), 3);
  const sentThree: PriorFollowUp = { days: 3, status: "executed", decision: "approved" };
  assert.equal(due({ now: on("2026-10-06"), prior: [sentThree] }), null, "day 5: the day-3 one is done");
  assert.equal(due({ now: on("2026-10-08"), prior: [sentThree] }), 7);
  assert.equal(due({ now: on("2026-10-20"), prior: [sentThree, { days: 7, status: "executed", decision: "approved" }] }), null, "two at most");
});

test("latest only: a proposal first seen on day 8 gets the day-7 note, not both", () => {
  assert.equal(due({ now: on("2026-10-09") }), 7);
});

test("not while one waits, and never again once the studio declines one", () => {
  assert.equal(due({ now: on("2026-10-08"), prior: [{ days: 3, status: "review_required", decision: null }] }), null);
  assert.equal(due({ now: on("2026-10-08"), prior: [{ days: 3, status: "rejected", decision: "rejected" }] }), null);
  assert.equal(due({ now: on("2026-10-08"), prior: [{ days: 3, status: "dismissed", decision: "dismissed" }] }), null);
});

test("not once the client has written, answered, or the offer has lapsed", () => {
  assert.equal(due({ lastInboundAt: "2026-10-02T09:00:00.000Z" }), null, "they wrote after it went out");
  assert.equal(due({ lastInboundAt: "2026-09-20T09:00:00.000Z" }), 3, "a message from before doesn't count");
  for (const status of ["accepted", "declined", "withdrawn", "superseded", "expired", "draft"])
    assert.equal(due({ proposal: { ...proposal, status } }), null, status);
  assert.equal(due({ proposal: { ...proposal, status: "viewed" } }), 3, "viewed is still waiting");
  assert.equal(due({ proposal: { ...proposal, expiresAt: "2026-10-04T00:00:00.000Z" } }), null, "expired");
  assert.equal(due({ proposal: { ...proposal, sentAt: null } }), null, "never sent");
});

test("still open means sent or viewed, and not past its expiry", () => {
  assert.equal(proposalStillOpen({ status: "viewed", expiresAt: "2026-10-31T00:00:00Z" }, "2026-10-10T00:00:00Z"), true);
  assert.equal(proposalStillOpen({ status: "viewed", expiresAt: "2026-10-09T00:00:00Z" }, "2026-10-10T00:00:00Z"), false);
  assert.equal(proposalStillOpen({ status: "accepted", expiresAt: "2026-10-31T00:00:00Z" }, "2026-10-10T00:00:00Z"), false);
  assert.equal(proposalStillOpen(null, "2026-10-10T00:00:00Z"), false);
  assert.equal(proposalFollowUpActionId("prop_1", 7), "ai_proposal_followup_prop_1_7");
});

test("the note is the studio writing, with no job-kind words and never Cue", () => {
  const base = {
    viewed: false,
    firstName: "Ella",
    projectName: "Hart Wedding",
    sentAt: "2026-10-01T15:00:00.000Z",
    expiresAt: "2026-10-31T00:00:00.000Z",
    studioName: "GR Productions",
  };
  const unseen = proposalFollowUpCopy({ ...base, days: 3 });
  const seen = proposalFollowUpCopy({ ...base, days: 3, viewed: true });
  const last = proposalFollowUpCopy({ ...base, days: 7 });
  assert.equal(unseen.subject, "Did your proposal reach you?");
  assert.match(unseen.body, /on October 1/);
  assert.equal(seen.subject, "Any questions about your proposal?");
  assert.equal(last.subject, "Still thinking it over?");
  for (const copy of [unseen, seen, last]) {
    assert.match(copy.body, /^Hi Ella,/);
    assert.match(copy.body, /Warmly,\nGR Productions$/);
    assert.doesNotMatch(`${copy.subject} ${copy.body}`, /\bCue\b/);
    // The project's own name is the only place a kind word may appear.
    assert.doesNotMatch(`${copy.subject} ${copy.body}`.replaceAll("Hart Wedding", ""), /\b(wedding|couple|bride|groom)s?\b/i);
  }
  assert.match(seen.body, /open until October 31/);
  assert.match(last.body, /open until October 31/);
  assert.match(proposalFollowUpCopy({ ...base, days: 3, firstName: null }).body, /^Hi there,/);
});

test("drafted daily alongside the inquiry follow-ups, as drafts that wait for a tap", () => {
  assert.match(read("functions/src/intake/follow-up-scheduler.ts"), /await advanceProposalFollowUps\(db, now\)/);
  const source = read("functions/src/booking/proposal-follow-ups.ts");
  assert.match(source, /status: "review_required",/);
  assert.doesNotMatch(source, /emailJobs\//, "drafting never queues an email itself");
  assert.doesNotMatch(source, /lifecycleTrigger/, "not a lifecycle trigger, so the trust dial never offers auto-send");
  // A combined proposal's agreement already has the contract reminders.
  assert.match(source, /where\("proposalId", "==", proposal\.id\)/);
  assert.match(source, /contracts\.docs\.some\(\(contract\) => \["sent", "viewed"\]\.includes\(text\(contract\.get\("status"\)\)\)\)\) return false;/);
});

test("an answered proposal is caught at approval and again as the email goes", () => {
  const actions = read("functions/src/ai/actions.ts");
  assert.match(actions, /const proposalFollowUp = record\(record\(action\.get\("structuredOutput"\)\)\.proposalFollowUp\);/);
  assert.match(actions, /throw new Error\("PROPOSAL_NO_LONGER_OPEN"\)/);
  assert.match(read("functions/src/ai/approved-communication.ts"), /proposalFollowUpId: input\.proposalFollowUpId/);
  assert.match(read("functions/src/operations/jobs.ts"), /return \{ held: "proposal_no_longer_open", type \};/);
  assert.match(read("lib/ai/friendly-error.ts"), /PROPOSAL_NO_LONGER_OPEN:/);
});

// ── Today ──────────────────────────────────────────────────────────────

const NOW = "2026-10-08T12:00:00.000Z";
const draft = {
  id: "ai_proposal_followup_prop-1_7",
  projectId: "project-1",
  status: "review_required",
  capability: "delivery_message_draft",
  title: "Follow up with Ella on their proposal",
  structuredOutput: {
    subject: "Still thinking it over?",
    body: "Hi Ella,\n\nJust checking in…",
    recipientEmail: "ella@example.com",
    proposalFollowUp: { proposalId: "prop-1", days: 7 },
  },
  createdAt: "2026-10-08T14:00:00.000Z",
  updatedAt: "2026-10-08T14:00:00.000Z",
};
const project = { id: "project-1", name: "Hart Wedding", state: "PROPOSAL", eventDate: "2027-06-12" };
const open = { id: "prop-1", projectId: "project-1", status: "viewed", expiresAt: "2026-10-31T00:00:00.000Z" };
const base: TodayInput = { now: NOW, projects: [project], aiActions: [draft] };
const offered = (input: TodayInput) =>
  todayInbox(input).approve.some((item) => item.action.kind === "approve" && item.action.actionId === draft.id);

test("Today: the follow-up is offered while the proposal waits, and gone once it's answered or lapsed", () => {
  assert.equal(offered({ ...base, proposals: [open] }), true);
  assert.equal(offered({ ...base, proposals: [{ ...open, status: "accepted" }] }), false);
  assert.equal(offered({ ...base, proposals: [{ ...open, status: "withdrawn" }] }), false);
  assert.equal(offered({ ...base, proposals: [{ ...open, expiresAt: "2026-10-07T00:00:00.000Z" }] }), false);
  assert.equal(offered({ ...base, proposals: [] }), false, "a proposal Today can't see is not chased from it");
});
