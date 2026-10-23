import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  clientOutreachHoldFor,
  isClientOfProject,
  releaseChecksClientOutreach,
  scheduledClientMessageGuard,
  scheduledReleaseUpdate,
} from "../functions/src/communications/scheduled-client-message";
import { emailProblemOf } from "@/features/today/email-problems";
import { todayInbox } from "@/features/today/inbox";

/**
 * A message the studio scheduled for later must not reach a client whose job
 * was cancelled, lost or archived before it was due (audit 2026-10-22).
 * `scheduledEmailRelease` used to flip `scheduled` to `queued` with no check,
 * and the manual messages it released never carried `clientOutreachGuard`,
 * so the worker's send-time recheck was skipped too.
 */

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const NOW = "2026-10-23T12:00:00.000Z";

const live = { tenantId: "t1", state: "BOOKED", clientContactIds: ["c_couple"] };
const cancelled = { ...live, state: "CANCELLED" };
const lost = { ...live, state: "LOST" };
const archived = { ...live, state: "ARCHIVED", archivedAt: "2026-10-22T09:00:00.000Z" };
const quiet = { ...live, clientAutomationsPausedAt: "2026-10-01T00:00:00.000Z" };

const scheduledToCouple = (project: unknown) => ({
  id: "manual_draft_1",
  tenantId: "t1",
  projectId: "p1",
  contactId: "c_couple",
  type: "manual_message",
  status: "scheduled",
  scheduledFor: "2026-10-23T11:55:00.000Z",
  ...scheduledClientMessageGuard({ scheduled: true, project, contactId: "c_couple" }),
});

test("a scheduled message to a client of the job carries the send-time guard", () => {
  const guard = scheduledClientMessageGuard({ scheduled: true, project: live, contactId: "c_couple" });
  assert.deepEqual(guard, { clientOutreachGuard: true, clientOutreachStopAccepted: null });
});

test("a message that goes now is the studio's own act and is not guarded", () => {
  assert.deepEqual(scheduledClientMessageGuard({ scheduled: false, project: live, contactId: "c_couple" }), {});
});

test("crew, vendor and studio recipients are never guarded", () => {
  assert.equal(isClientOfProject(live, "c_crew"), false);
  assert.deepEqual(scheduledClientMessageGuard({ scheduled: true, project: live, contactId: "c_crew" }), {});
  assert.deepEqual(scheduledClientMessageGuard({ scheduled: true, project: live, contactId: null }), {});
});

test("a message to a client of a job cancelled, lost or archived since is held at release", () => {
  for (const [project, reason] of [
    [cancelled, "cancelled"],
    [lost, "cancelled"],
    [archived, "put_away"],
  ] as const) {
    const job = scheduledToCouple(live);
    const update = scheduledReleaseUpdate(job, project, NOW);
    assert.equal(update.status, "succeeded", `${project.state} is not queued`);
    assert.deepEqual(update.result, {
      held: "client_outreach_stopped",
      reason,
      type: "manual_message",
      heldAt: "release",
    });
    assert.equal(update.completedAt, NOW);
  }
});

test("a job that is gone holds the message rather than sending it", () => {
  const update = scheduledReleaseUpdate(scheduledToCouple(live), null, NOW);
  assert.equal(update.status, "succeeded");
  assert.equal((update.result as Record<string, unknown>).reason, "job_missing");
});

test("a live job's message is released to go, still guarded for the send", () => {
  const update = scheduledReleaseUpdate(scheduledToCouple(live), live, NOW);
  assert.deepEqual(update, { status: "queued", clientOutreachGuard: true, updatedAt: NOW });
});

test("the send-time recheck holds a job stopped between release and send", () => {
  const job = scheduledToCouple(live);
  assert.equal(clientOutreachHoldFor(job, live), null);
  assert.equal(clientOutreachHoldFor(job, cancelled), "cancelled");
  assert.equal(clientOutreachHoldFor(job, archived), "put_away");
  assert.equal(clientOutreachHoldFor(job, null), "job_missing");
});

test("a stop the studio could already see when it scheduled is accepted, a new one is not", () => {
  // A quiet imported booking (ADR 0005): the studio wrote to them on purpose.
  const job = scheduledToCouple(quiet);
  assert.equal(job.clientOutreachStopAccepted, "automations_paused");
  assert.equal(clientOutreachHoldFor(job, quiet), null);
  assert.equal(scheduledReleaseUpdate(job, quiet, NOW).status, "queued");
  // Archived since: held.
  assert.equal(clientOutreachHoldFor(job, { ...quiet, state: "ARCHIVED", archivedAt: NOW }), "put_away");
});

test("other guarded sends accept no stop, as before", () => {
  const approved = { projectId: "p1", clientOutreachGuard: true };
  assert.equal(clientOutreachHoldFor(approved, quiet), "automations_paused");
  assert.equal(clientOutreachHoldFor(approved, { ...live, state: "POSTPONED" }), "on_hold");
  assert.equal(clientOutreachHoldFor(approved, { ...live, state: "CLOSED" }), null);
});

test("crew and studio mail is released untouched, whatever the job's state", () => {
  const crew = {
    id: "crew_1",
    tenantId: "t1",
    projectId: "p1",
    contactId: "c_crew",
    type: "manual_message",
    status: "scheduled",
  };
  assert.equal(releaseChecksClientOutreach(crew, cancelled), false);
  assert.deepEqual(scheduledReleaseUpdate(crew, cancelled, NOW), { status: "queued", updatedAt: NOW });
  const studio = { id: "s1", tenantId: "t1", projectId: "p1", type: "crew_assignment", status: "scheduled" };
  assert.deepEqual(scheduledReleaseUpdate(studio, archived, NOW), { status: "queued", updatedAt: NOW });
  // A job explicitly marked unguarded (the studio's own immediate press) stays so.
  const unguarded = { ...crew, contactId: "c_couple", clientOutreachGuard: false };
  assert.deepEqual(scheduledReleaseUpdate(unguarded, cancelled, NOW), { status: "queued", updatedAt: NOW });
});

test("a manual message scheduled before the guard existed is still checked at release", () => {
  const legacy = {
    id: "manual_old",
    tenantId: "t1",
    projectId: "p1",
    contactId: "c_couple",
    type: "manual_message",
    status: "scheduled",
  };
  assert.equal(scheduledReleaseUpdate(legacy, cancelled, NOW).status, "succeeded");
  assert.deepEqual(scheduledReleaseUpdate(legacy, live, NOW), {
    status: "queued",
    clientOutreachGuard: true,
    updatedAt: NOW,
  });
});

test("a held scheduled message shows on Today as not sent, never as delivered", () => {
  const held = {
    id: "manual_draft_1",
    tenantId: "t1",
    projectId: "p1",
    type: "manual_message",
    recipient: "couple@example.com",
    customSubject: "See you Saturday",
    scheduledFor: "2026-10-23T11:55:00.000Z",
    status: "succeeded",
    result: { held: "client_outreach_stopped", reason: "cancelled", type: "manual_message", heldAt: "release" },
    updatedAt: NOW,
  };
  const problem = emailProblemOf(held);
  assert.equal(problem?.kind, "held");
  assert.equal(problem?.title, "A scheduled message wasn't sent");
  assert.match(problem?.reason ?? "", /canceled or lost/);
  assert.equal(problem?.canRetry, false);
  assert.equal(problem?.fixHref, "/studio/projects/p1");
  assert.equal(problem?.fixLabel, "Open the job");

  const inbox = todayInbox({ now: NOW, emailJobs: [held] });
  const card = inbox.act.find((item) => item.id === "email-manual_draft_1");
  assert.ok(card, "the held message is on Today");
  assert.match(card.detail, /See you Saturday · to couple@example.com/);
  assert.equal(card.action?.kind, "email_problem");
  if (card.action?.kind !== "email_problem") return;
  assert.equal(card.action.label, "Open the job");
  assert.equal(card.action.canRetry, false);

  // Left it: the card goes.
  assert.equal(emailProblemOf({ ...held, studioDismissedAt: NOW }), null);
  // An automatic send held because the job was put away is the silence the
  // studio asked for, not a card.
  const { scheduledFor: _scheduledFor, ...automatic } = held;
  void _scheduledFor;
  assert.equal(emailProblemOf(automatic), null);
  // A scheduled message that did go is not a problem.
  assert.equal(emailProblemOf({ ...held, result: { messageId: "m1" } }), null);
});

test("source pins: every scheduled manual message path is guarded, and release and send both check", () => {
  const commands = source("functions/src/communications/commands.ts");
  const send = commands.slice(commands.indexOf('if (command.type === "sendMessage")'));
  assert.match(send.slice(0, 6000), /\.\.\.scheduledClientMessageGuard\(\{/);
  for (const command of ['command.type === "approveMessage"', 'command.type === "sendApprovedDraft"']) {
    const block = commands.slice(commands.indexOf(command)).slice(0, 4000);
    assert.match(block, /await scheduledDraftGuard\(/, `${command} reads the job for a scheduled draft`);
    assert.match(block, /\.\.\.guard,/, `${command} writes the guard on the emailJob`);
  }
  const release = commands.slice(commands.indexOf("export const scheduledEmailRelease"));
  assert.match(release, /scheduledReleaseUpdate\(data, project, now\)/);
  assert.doesNotMatch(release, /batch\.update\(job\.ref, \{ status: "queued"/);

  const jobs = source("functions/src/operations/jobs.ts");
  assert.match(jobs, /document\.get\("clientOutreachGuard"\) === true/);
  assert.match(jobs, /clientOutreachHoldFor\(objectValue\(document\.data\(\)\), data \?\? null\)/);

  const today = source("components/today/today-inbox.tsx");
  assert.match(today, /\{action\.fixLabel\}/);
});
