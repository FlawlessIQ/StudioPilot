import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  UNDO_SEND_WINDOW_MS,
  approvedEmailJobId,
  cancelQueuedEmailRefusal,
  emailHeldBack,
  heldSendFields,
} from "../functions/src/communications/undo-send.ts";
import { approvedCommunicationDispatch } from "../functions/src/ai/approved-communication.ts";
import { decisionGate } from "../functions/src/ai/decision-guard.ts";
import {
  SUPERSEDABLE_BRIEF_STATUSES,
  bookingBriefRerunRefusal,
  briefActionIds,
  briefJobId,
  briefRunOf,
} from "../functions/src/booking/brief-rerun.ts";
import { briefRerunBlocked, currentBriefActions } from "@/features/booking/brief-run";
import { heldSendFrom } from "@/components/communications/undo-send";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";

/**
 * Two gaps (2026-09-30):
 *
 * 1. Re-saving consultation notes never re-ran the booking brief — the
 *    analysis was made once per consultation, so a studio that added what the
 *    couple said on a second call kept the first brief for good.
 * 2. Today's one-tap "Send reply" had no undo. It stays one tap; the server
 *    holds the email ten seconds and `cancelQueuedEmail` calls it back.
 */

const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const NOW = "2026-09-30T12:00:00.000Z";

// ─── 2. Undo on a one-tap send ────────────────────────────────────────────

const draft = {
  actionId: "ai_reply_lead-emma",
  tenantId: "t1",
  projectId: "p1",
  leadId: "lead-emma",
  contactId: "c1",
  recipient: "emma@example.com",
  recipientName: "Emma",
  projectName: "Emma & Sam",
  subject: "Your date",
  body: "Thank you for reaching out.",
  category: "general",
  now: NOW,
  requestedBy: "owner-1",
};

test("a send from Today is queued but not due until the undo window closes", () => {
  const job = approvedCommunicationDispatch({ ...draft, holdForUndo: true }).emailJob!;
  assert.equal(job.status, "queued");
  assert.equal(job.sendAfter, at(NOW, UNDO_SEND_WINDOW_MS));
  // The queue's own retry clock is what the dispatcher schedules the task for.
  assert.equal(job.nextAttemptAt, job.sendAfter);
  assert.equal(job.requestedBy, "owner-1");
  assert.equal(emailHeldBack(job, at(NOW, 5_000)), true, "held inside the window");
  assert.equal(emailHeldBack(job, at(NOW, UNDO_SEND_WINDOW_MS + 1)), false, "due once it closes");
});

test("every other approval still sends immediately", () => {
  const job = approvedCommunicationDispatch(draft).emailJob! as Record<string, unknown>;
  assert.equal(job.sendAfter, undefined);
  assert.equal(job.nextAttemptAt, undefined);
  assert.equal(emailHeldBack(job, NOW), false);
});

test("an undone send is never due, however long it waits", () => {
  const job = { ...heldSendFields(NOW, "owner-1"), status: "cancelled", cancelledAt: at(NOW, 3_000) };
  assert.equal(emailHeldBack(job, at(NOW, 60 * 60 * 1000)), true);
});

const held = { tenantId: "t1", status: "queued", sendAfter: at(NOW, UNDO_SEND_WINDOW_MS), requestedBy: "coord-1" };
const ask = (job: Record<string, unknown> | null, actor = "coord-1", ownerOrAdmin = false) =>
  cancelQueuedEmailRefusal({ job, tenantId: "t1", actorId: actor, ownerOrAdmin });

test("the sender, or an owner or admin, can undo while nothing has gone", () => {
  assert.equal(ask(held), null);
  assert.equal(ask({ ...held, status: "retry_scheduled" }), null);
  assert.equal(ask(held, "owner-2", true), null);
  assert.equal(ask(held, "coord-2", false), "EMAIL_UNDO_NOT_ALLOWED");
});

test("once it is running or sent, undo says so rather than pretending", () => {
  for (const status of ["running", "succeeded", "dead_letter", "failed"])
    assert.equal(ask({ ...held, status }), "EMAIL_ALREADY_SENT", status);
});

test("only a held send can be called back; other mail and other studios are refused", () => {
  assert.equal(ask({ ...held, sendAfter: undefined }), "EMAIL_NOT_UNDOABLE");
  assert.equal(ask({ ...held, tenantId: "t2" }), "EMAIL_JOB_NOT_FOUND");
  assert.equal(ask(null), "EMAIL_JOB_NOT_FOUND");
});

test("a second Undo answers with the first rather than failing", () => {
  assert.equal(ask({ ...held, status: "cancelled" }), "already_cancelled");
});

test("undo, then send again: the draft is decidable and the new send gets a new job", () => {
  // The cancel puts the action back to review_required; a fresh approval
  // must proceed, and must not collide with the cancelled job's id.
  assert.equal(decisionGate("review_required", "approved"), "proceed");
  const first = approvedCommunicationDispatch({ ...draft, holdForUndo: true }).emailJob!;
  const again = approvedCommunicationDispatch({ ...draft, holdForUndo: true, undoCount: 1 }).emailJob!;
  assert.equal(first.id, "ai_message_ai_reply_lead-emma");
  assert.equal(again.id, "ai_message_ai_reply_lead-emma_u1");
  assert.equal(approvedEmailJobId("a", 2), "ai_message_a_u2");
});

test("the worker re-checks the hold and the cancel inside the claim transaction", () => {
  const jobs = readFileSync("functions/src/operations/jobs.ts", "utf8");
  const claim = jobs.slice(jobs.indexOf("async function claim"), jobs.indexOf("async function finish"));
  assert.match(claim, /runTransaction/);
  assert.match(claim, /emailHeldBack\(/);
  assert.match(claim, /cancelledAt/);
  const queue = readFileSync("functions/src/operations/task-queue.ts", "utf8");
  assert.match(queue.slice(queue.indexOf("function scheduleTime")), /sendAfter/);
});

test("a cancelled email cannot be retried or rerun into sending", () => {
  const comms = readFileSync("functions/src/communications/commands.ts", "utf8");
  const retry = comms.slice(comms.indexOf('if (type === "retryEmailJob")'));
  assert.match(retry, /if \(!\["failed", "dead_letter"\]\.includes\(status\)\)\s*throw new Error\("EMAIL_JOB_NOT_RETRYABLE"\)/);
  const admin = readFileSync("functions/src/saas/admin.ts", "utf8");
  const rerun = admin.slice(admin.indexOf('parsed.type === "rerunJob"'), admin.indexOf("JOB_NOT_RERUNNABLE"));
  assert.doesNotMatch(rerun, /"cancelled"/);
});

test("the browser only offers Undo for a send the server actually held", () => {
  assert.deepEqual(heldSendFrom({ emailJobId: "j1", undoWindowMs: 10_000 }, "your reply"), {
    emailJobId: "j1",
    windowMs: 10_000,
    label: "your reply",
  });
  assert.equal(heldSendFrom({ emailJobId: "j1", undoWindowMs: null }, "x"), null);
  assert.equal(heldSendFrom({ emailQueued: true }, "x"), null);
});

// ─── 1. Prepare the booking brief again ───────────────────────────────────

const ready = {
  consultationStatus: "completed",
  projectState: "CONSULTATION",
  proposalStatuses: [] as string[],
  currentJobStatus: "succeeded" as string | null,
};

test("a completed consultation at the consultation stage can be prepared again", () => {
  assert.equal(bookingBriefRerunRefusal(ready), null);
  assert.equal(bookingBriefRerunRefusal({ ...ready, currentJobStatus: "dead_letter" }), null);
  // An unsent draft proposal does not make the brief moot.
  assert.equal(bookingBriefRerunRefusal({ ...ready, proposalStatuses: ["draft", "discarded"] }), null);
});

test("refused once a proposal has gone to the couple, or the job has moved on", () => {
  for (const status of ["sent", "viewed", "accepted"])
    assert.equal(bookingBriefRerunRefusal({ ...ready, proposalStatuses: ["superseded", status] }), "BOOKING_BRIEF_MOOT");
  assert.equal(bookingBriefRerunRefusal({ ...ready, projectState: "PROPOSAL" }), "BOOKING_BRIEF_MOOT");
  assert.equal(bookingBriefRerunRefusal({ ...ready, projectState: "BOOKED" }), "BOOKING_BRIEF_MOOT");
  assert.equal(bookingBriefRerunRefusal({ ...ready, projectState: "LEAD" }), "PROJECT_NOT_IN_CONSULTATION");
});

test("refused with no notes saved, or while the last run is still being prepared", () => {
  assert.equal(bookingBriefRerunRefusal({ ...ready, consultationStatus: "scheduled" }), "CONSULTATION_NOT_COMPLETED");
  for (const status of ["queued", "running", "retry_scheduled"])
    assert.equal(bookingBriefRerunRefusal({ ...ready, currentJobStatus: status }), "BOOKING_BRIEF_ALREADY_PREPARING");
});

test("every refusal reads as a sentence", () => {
  for (const code of [
    "BOOKING_BRIEF_MOOT",
    "BOOKING_BRIEF_ALREADY_PREPARING",
    "CONSULTATION_NOT_COMPLETED",
    "PROJECT_NOT_IN_CONSULTATION",
    "EMAIL_ALREADY_SENT",
    "EMAIL_NOT_UNDOABLE",
    "EMAIL_UNDO_NOT_ALLOWED",
    "EMAIL_JOB_NOT_FOUND",
  ])
    assert.ok(errorCodeHasCopy(code), code);
});

test("the page offers the rerun exactly where the server would accept it", () => {
  const states = ["LEAD", "LOST", "CONSULTATION", "PROPOSAL", "BOOKED"];
  const statuses = ["scheduled", "completed"];
  const proposals = [[], ["draft"], ["sent"], ["accepted"]];
  for (const projectState of states)
    for (const consultationStatus of statuses)
      for (const proposalStatuses of proposals) {
        const input = { projectState, consultationStatus, proposalStatuses };
        const server = bookingBriefRerunRefusal({ ...input, currentJobStatus: null });
        assert.equal(
          briefRerunBlocked(input) === null,
          server === null,
          JSON.stringify(input),
        );
      }
});

test("run 1 keeps the ids it always had; a rerun writes its own", () => {
  assert.equal(briefJobId("c1", 1), "consultation_c1");
  assert.deepEqual(briefActionIds("c1", 1), {
    summary: "ai_consultation_c1",
    package: "ai_package_c1",
    proposal: "ai_proposal_c1",
  });
  assert.equal(briefJobId("c1", 2), "consultation_c1_r2");
  assert.equal(briefActionIds("c1", 3).package, "ai_package_c1_r3");
  assert.equal(briefRunOf(undefined), 1);
  assert.equal(briefRunOf("nonsense"), 1);
  assert.equal(briefRunOf(4), 4);
});

test("only undecided work is superseded, and nothing can approve it afterwards", () => {
  assert.deepEqual([...SUPERSEDABLE_BRIEF_STATUSES].sort(), ["failed", "queued", "review_required", "running"]);
  for (const decision of ["approved", "rejected", "dismissed"] as const)
    assert.equal(decisionGate("superseded", decision), "refuse");
});

test("the booking page shows the current run's brief, never the one set aside", () => {
  const actions = [
    { id: "ai_consultation_c1", capability: "consultation_summary", status: "superseded" },
    { id: "ai_package_c1", capability: "package_recommendation", status: "approved" },
    { id: "ai_proposal_c1", capability: "proposal_draft", status: "superseded" },
    { id: "ai_consultation_c1_r2", capability: "consultation_summary", status: "review_required", briefRun: 2 },
    { id: "ai_package_c1_r2", capability: "package_recommendation", status: "review_required", briefRun: 2 },
  ];
  const second = currentBriefActions(actions, { briefRun: 2 });
  assert.equal(second.summary?.id, "ai_consultation_c1_r2");
  assert.equal(second.package?.id, "ai_package_c1_r2");
  // Still being written: the page shows "preparing", not the old draft.
  assert.equal(second.proposal, undefined);
  // A consultation that was never rerun reads exactly as before.
  const first = currentBriefActions(actions.slice(0, 3).map((a) => ({ ...a, status: "review_required" })), {});
  assert.equal(first.package?.id, "ai_package_c1");
});

test("the analysis runner refuses to write for a run that is no longer current", () => {
  const runner = readFileSync("functions/src/operations/ai-pdf.ts", "utf8");
  const body = runner.slice(runner.indexOf("async function runConsultationAnalysis"), runner.indexOf("async function runQuestionnaireAnalysis"));
  assert.match(body, /briefRunOf\(consultation\.get\("briefRun"\)\)!==run/);
  assert.match(body, /briefActionIds\(consultationId,run\)/);
  assert.doesNotMatch(body, /`ai_package_\$\{consultationId\}`/);
});

test("a rerun is charged before it is queued, like the first run", () => {
  const commands = readFileSync("functions/src/booking/commands.ts", "utf8");
  const branch = commands.slice(
    commands.indexOf('command.type === "rerunBookingBrief"'),
    commands.indexOf('command.type === "scheduleConsultation"'),
  );
  const charge = branch.indexOf("consumeAiQuota(");
  assert.ok(charge > 0, "rerun charges AI usage");
  assert.ok(charge < branch.indexOf("transaction.create(jobReference"), "charged before the job is queued");
  assert.match(branch, /status: "superseded"/);
  assert.doesNotMatch(branch, /\.delete\(/);
});
