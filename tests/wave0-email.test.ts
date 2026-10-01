import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  SEND_ON_APPROVAL_CAPABILITIES as SERVER_SEND_CAPABILITIES,
  approvedCommunicationDispatch,
  sendsOnApproval as serverSendsOnApproval,
} from "../functions/src/ai/approved-communication";
import { decisionGate } from "../functions/src/ai/decision-guard";
import { isAnsweredReplyDraft } from "../functions/src/communications/answered-drafts";
import {
  SEND_ON_APPROVAL_CAPABILITIES as CARD_SEND_CAPABILITIES,
  approvalConsequenceSentence,
  dispatchesOnApproval,
} from "@/features/ai/approval-consequence";
import { emailProblemOf } from "@/features/today/email-problems";
import { todayInbox } from "@/features/today/inbox";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendOutcomeCopy } from "@/lib/communications/send-outcome";
import { defaultLifecycleMessagingSettings } from "@/features/messaging/schema";
import { trustDialOffers, type LifecycleDecision } from "@/features/messaging/trust-dial";

/**
 * Wave 0 — the client-email bugs found by the 2026-09-30 audit. Each block
 * names the bug it holds shut. A couple getting an email twice and a couple
 * never getting one the studio approved are both on this list.
 */

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const readable = (value: string) => value.replaceAll("_", " ");

// ─── 1. Approved lifecycle / delivery / review drafts are sent ─────────────

test("approving a lifecycle, delivery, album or review draft sends it", () => {
  for (const capability of ["delivery_message_draft", "review_request_draft"]) {
    assert.equal(serverSendsOnApproval(capability), true, capability);
  }
  // The three that always worked still do.
  for (const capability of ["inquiry_reply_draft", "planning_followup_draft", "inquiry_follow_up"]) {
    assert.equal(serverSendsOnApproval(capability), true, capability);
  }
  // A proposal cover travels with its proposal; approving only saves it.
  assert.equal(serverSendsOnApproval("proposal_draft"), false);
});

test("the card and the server name the same sending capabilities", () => {
  assert.deepEqual([...CARD_SEND_CAPABILITIES], [...SERVER_SEND_CAPABILITIES]);
});

test("decideAiAction queues through the shared list, not a hard-coded three", () => {
  const actions = source("functions/src/ai/actions.ts");
  assert.match(actions, /sendsOnApproval\(capability\)/);
  assert.doesNotMatch(actions, /\["inquiry_reply_draft", "planning_followup_draft", "inquiry_follow_up"\]\.includes/);
  // The scheduler's drafts are the capability that now sends.
  assert.match(source("functions/src/communications/lifecycle-scheduler.ts"), /capability: "delivery_message_draft"/);
  const drafts = source("functions/src/ai/message-draft.ts");
  assert.match(drafts, /delivery_note: "delivery_message_draft"/);
  assert.match(drafts, /review_request: "review_request_draft"/);
});

test("an approved email is re-checked against the job's contact rules as it goes", () => {
  const dispatch = approvedCommunicationDispatch({
    actionId: "a1",
    tenantId: "t1",
    projectId: "p1",
    contactId: null,
    recipient: "couple@example.com",
    recipientName: "Sam",
    projectName: "Smith Wedding",
    subject: "A month to go",
    body: "Your timeline is attached.",
    category: "general",
    now: "2026-09-30T12:00:00.000Z",
  });
  assert.equal(dispatch.emailJob?.clientOutreachGuard, true);
  assert.equal(dispatch.emailJob?.aiActionId, "a1");
  const actions = source("functions/src/ai/actions.ts");
  // Refused at approval for an archived, paused or cancelled job...
  assert.match(actions, /mayContactClient\(data\)[\s\S]{0,120}CLIENT_OUTREACH_STOPPED/);
  // ...and held by the worker if that changed after approval.
  const jobs = source("functions/src/operations/jobs.ts");
  assert.match(jobs, /document\.get\("clientOutreachGuard"\) === true/);
  assert.match(jobs, /held: "client_outreach_stopped"/);
});

test("the card promises a send only where the server sends", () => {
  const draft = {
    downstreamCommandType: null,
    recipient: "couple@example.com",
    subject: "A month to go",
    body: "Hello",
  };
  assert.equal(dispatchesOnApproval({ ...draft, capability: "delivery_message_draft" }), true);
  assert.match(
    approvalConsequenceSentence({ ...draft, capability: "review_request_draft" }, readable),
    /^Approving emails this to couple@example.com/,
  );
  assert.equal(dispatchesOnApproval({ ...draft, capability: "proposal_draft" }), false);
  assert.match(
    approvalConsequenceSentence({ ...draft, capability: "proposal_draft" }, readable),
    /saves the draft/,
  );
});

test("the trust dial counts only approvals that sent", () => {
  const unsent = (day: number): LifecycleDecision => ({
    trigger: "day_before_checklist",
    decidedAt: `2026-09-0${day}T12:00:00.000Z`,
    approved: true,
    edited: false,
    sent: false,
  });
  assert.deepEqual(
    trustDialOffers([unsent(1), unsent(2), unsent(3)], defaultLifecycleMessagingSettings),
    [],
  );
  const sent = (day: number): LifecycleDecision => ({ ...unsent(day), sent: true });
  assert.deepEqual(
    trustDialOffers([sent(1), sent(2), sent(3)], defaultLifecycleMessagingSettings),
    ["day_before_checklist"],
  );
  // decideAiAction records the job the approval created; the offer reads it.
  assert.match(source("functions/src/ai/actions.ts"), /emailJobId,\n\s+},\n\s+decisionResult/);
  assert.match(source("components/communications/trust-dial-offers.tsx"), /sent:\s+typeof decision\.emailJobId === "string"/);
});

// ─── 2. Approving twice does not send twice ────────────────────────────────

test("a decision runs once; the same decision again runs nothing", () => {
  assert.equal(decisionGate("review_required", "approved"), "proceed");
  assert.equal(decisionGate("approved", "approved"), "repeat");
  assert.equal(decisionGate("rejected", "rejected"), "repeat");
  assert.equal(decisionGate("approved", "dismissed"), "refuse");
  assert.equal(decisionGate("dismissed", "approved"), "refuse");
  assert.equal(decisionGate("executed", "approved"), "refuse");
  // A draft that failed, or is still being written, can still be put away.
  assert.equal(decisionGate("failed", "dismissed"), "proceed");
  assert.equal(decisionGate("running", "dismissed"), "proceed");
  assert.equal(decisionGate("failed", "approved"), "refuse");
  assert.equal(decisionGate("queued", "approved"), "refuse");
});

test("the email job is created inside the decision transaction, never overwritten", () => {
  const actions = source("functions/src/ai/actions.ts");
  assert.doesNotMatch(actions, /communicationDispatch\.emailJob,\s*\{ merge: false \}/);
  assert.match(actions, /transaction\.create\(\s*db\.doc\(`emailJobs\/\$\{communicationDispatch\.emailJob\.id\}`\)/);
  // The status is read again inside the transaction.
  assert.match(actions, /const fresh = await transaction\.get\(actionReference\);[\s\S]{0,120}decisionGate\(text\(fresh\.get\("status"\)\)/);
  assert.match(actions, /AI_ACTION_ALREADY_DECIDED/);
});

test("a second approval reads as done, not as a failure", () => {
  assert.match(friendlyError(new Error("AI_ACTION_ALREADY_DECIDED")), /Already done/);
  assert.match(friendlyError(new Error("AI_ACTION_ALREADY_DECIDED")), /nothing was sent again/);
  assert.match(friendlyError(new Error("CLIENT_OUTREACH_STOPPED:put_away")), /put away, so nothing was sent/);
  assert.match(friendlyError(new Error("CLIENT_OUTREACH_STOPPED:automations_paused")), /paused/);
  assert.match(friendlyError(new Error("CLIENT_OUTREACH_STOPPED:cancelled")), /cancelled/);
});

// ─── 3. A reply sent by hand retires the draft it came from ────────────────

test("a studio reply in a thread answers the drafts for that thread only", () => {
  const scope = { conversationId: "conv_a", leadId: null, projectId: "p1" };
  const draft = (overrides: Record<string, unknown>) => ({
    status: "review_required",
    capability: "inquiry_reply_draft",
    projectId: "p1",
    structuredOutput: {},
    ...overrides,
  });
  assert.equal(isAnsweredReplyDraft(draft({ conversationId: "conv_a" }), scope), true);
  // The other half of the couple, writing separately, is not answered.
  assert.equal(isAnsweredReplyDraft(draft({ conversationId: "conv_b" }), scope), false);
  // A job-level inquiry reply with no thread of its own is.
  assert.equal(isAnsweredReplyDraft(draft({}), scope), true);
  // A lifecycle message is its own message, not a reply.
  assert.equal(isAnsweredReplyDraft(draft({ capability: "delivery_message_draft" }), scope), false);
  // Already decided work is left alone.
  assert.equal(isAnsweredReplyDraft(draft({ conversationId: "conv_a", status: "approved" }), scope), false);
  // An inquiry's reply and follow-up, by lead.
  const leadScope = { conversationId: "conv_lead", leadId: "lead-1", projectId: null };
  assert.equal(
    isAnsweredReplyDraft(draft({ projectId: null, capability: "inquiry_follow_up", structuredOutput: { leadId: "lead-1" } }), leadScope),
    true,
  );
});

test("both send paths put answered drafts away in the same commit as the send", () => {
  const commands = source("functions/src/communications/commands.ts");
  const reply = commands.slice(commands.indexOf('command.type === "replyToConversation"'));
  assert.ok(
    reply.indexOf("dismissAnsweredReplyDrafts(db, batch") < reply.indexOf("await batch.commit()"),
    "replyToConversation dismisses before it commits",
  );
  const send = commands.slice(commands.indexOf('if (command.type === "sendMessage")'));
  assert.ok(
    send.indexOf("dismissAnsweredReplyDrafts(db, batch") < send.indexOf("await batch.commit()"),
    "sendMessage dismisses before it commits",
  );
  assert.match(source("functions/src/communications/answered-drafts.ts"), /status: "dismissed"[\s\S]{0,400}dismissedReason: "answered_by_studio_reply"/);
});

// ─── 4. A failed email can be retried or dismissed from Today ──────────────

const NOW = "2026-09-30T12:00:00.000Z";

test("a failed email is a card that acts in place, naming who, what and why", () => {
  const inbox = todayInbox({
    now: NOW,
    emailJobs: [
      {
        id: "manual_1",
        tenantId: "t1",
        projectId: "p1",
        type: "manual_message",
        recipient: "couple@example.com",
        customSubject: "Your timeline",
        status: "dead_letter",
        error: { code: "SENDGRID_SEND_FAILED", message: "SENDGRID_SEND_FAILED:500", retryable: false },
        updatedAt: "2026-09-30T10:00:00.000Z",
      },
    ],
  });
  const card = inbox.act.find((item) => item.id === "email-manual_1");
  assert.ok(card, "the failure is on Today");
  assert.equal(card.title, "An email did not send");
  assert.match(card.detail, /Your timeline · to couple@example.com/);
  assert.equal(card.action.kind, "email_problem");
  if (card.action.kind !== "email_problem") return;
  assert.equal(card.action.canRetry, true);
  assert.equal(card.action.emailJobId, "manual_1");
  assert.match(card.action.reason, /turned it down/);
});

test("a dismissed failure leaves Today", () => {
  const inbox = todayInbox({
    now: NOW,
    emailJobs: [{ id: "e1", status: "dead_letter", studioDismissedAt: NOW, updatedAt: NOW }],
  });
  assert.equal(inbox.act.some((item) => item.id === "email-e1"), false);
});

test("retry is a studio command that starts afresh and re-checks the job", () => {
  const commands = source("functions/src/communications/commands.ts");
  assert.match(commands, /type: z\.literal\("retryEmailJob"\)/);
  assert.match(commands, /type: z\.literal\("dismissEmailProblem"\)/);
  const retry = commands.slice(commands.indexOf('command.type === "retryEmailJob" ||'));
  assert.match(retry, /canApprove\(role\)/);
  assert.match(retry, /mayContactClient\(data\)/);
  assert.match(retry, /attempts: 0,/);
  assert.match(retry, /clientOutreachGuard: true,/);
  // A second press while it is on its way does not queue it twice.
  assert.match(retry, /\["queued", "running", "retry_scheduled"\]\.includes\(status\)/);
  // The platform rerun (Console → Jobs) also resets attempts and re-checks the job.
  const admin = source("functions/src/console/handlers/operations.ts");
  assert.match(admin, /attempts: 0,/);
  assert.match(admin, /clientOutreachGuard: true/);
  // Today's card calls it rather than linking to Messages.
  const today = source("components/today/today-inbox.tsx");
  assert.match(today, /function EmailProblemActions/);
  assert.match(today, /run\("retryEmailJob"\)/);
  assert.match(today, /run\("dismissEmailProblem"\)/);
});

// ─── 5. Bounces reach Today ────────────────────────────────────────────────

test("a bounced, blocked or dropped email is a Today problem, not a success", () => {
  const job = { id: "e2", projectId: "p1", recipient: "couple@exmaple.com", status: "succeeded" };
  for (const deliveryStatus of ["bounce", "blocked", "dropped"]) {
    const problem = emailProblemOf({ ...job, deliveryStatus });
    assert.ok(problem, deliveryStatus);
    assert.equal(problem.kind, "undelivered");
    assert.equal(problem.canRetry, false);
    assert.equal(problem.fixHref, "/studio/projects/p1");
    assert.equal(problem.recipient, "couple@exmaple.com");
  }
  assert.equal(emailProblemOf({ ...job, deliveryStatus: "delivered" }), null);
  assert.equal(emailProblemOf({ ...job, deliveryStatus: "deferred" }), null);
  assert.equal(emailProblemOf({ ...job, deliveryStatus: "bounce", studioDismissedAt: NOW }), null);
  // Platform sign-in mail and template tests are not the studio's to fix.
  assert.equal(emailProblemOf({ ...job, deliveryStatus: "bounce", type: "password_reset" }), null);
  assert.equal(emailProblemOf({ ...job, id: "template_test_1", deliveryStatus: "bounce" }), null);
  // An inquiry's address is fixed on the inquiry.
  assert.equal(emailProblemOf({ id: "e3", leadId: "l1", deliveryStatus: "bounce" })?.fixHref, "/studio/leads/l1");

  const inbox = todayInbox({ now: NOW, emailJobs: [{ ...job, deliveryStatus: "bounce", updatedAt: NOW }] });
  const card = inbox.act.find((item) => item.id === "email-e2");
  assert.equal(card?.title, "An email bounced");
  assert.equal(card?.action.kind, "email_problem");
});

test("SendGrid's blocked bounce is recorded as blocked, and the thread labels it", () => {
  const events = source("functions/src/communications/sendgrid-events.ts");
  assert.match(events, /event\.event === "bounce" && event\.type === "blocked"/);
  assert.match(events, /deliveryStatus,\n/);
  const inbox = source("components/communications/message-inbox.tsx");
  assert.match(inbox, /"bounced", "blocked", "dropped"/);
  assert.match(inbox, /value === "deferred"\)\s*\n\s*return "Waiting to send"/);
});

// ─── 6. Cue's reply card says what happened ────────────────────────────────

test("a send is described as it happened, never a flat Sent.", () => {
  assert.equal(sendOutcomeCopy({ mode: "preview", payload: {} }), "Preview mode — nothing was sent.");
  assert.match(sendOutcomeCopy({ mode: "live", payload: { requiresApproval: true } }), /owner's approval/);
  assert.match(sendOutcomeCopy({ mode: "live", payload: { emailJobId: "reply_1" } }), /^Queued to send/);
  const card = source("components/ai/actions/planning-actions.tsx");
  const reply = card.slice(card.indexOf("export function ReplyCard"), card.indexOf("export function MarkReadCard"));
  assert.doesNotMatch(reply, /return "Sent\."/);
  assert.match(reply, /sendOutcomeCopy\(/);
});
