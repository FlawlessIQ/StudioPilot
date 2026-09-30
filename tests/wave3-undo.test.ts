import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AGREEMENT_OUT,
  assertProposalAction,
  planUndoAcceptance,
} from "../functions/src/booking/proposal-domain.ts";
import {
  assigneeRefusal,
  checkpointReopenRefusal,
  reopenedCheckpointStatus,
  taskMoveRefusal,
} from "../functions/src/workflow/task-edits.ts";
import {
  consultationCorrectionRefusal,
  reopenedConsultationNeedsNotes,
} from "../functions/src/booking/consultation-undo.ts";
import {
  COI_APPROVABLE_STATUSES,
  coiRequestIsOpen,
  planCoiResend,
} from "../functions/src/coi/corrections.ts";
import { ACCEPTANCE_AGREEMENT_OUT } from "@/features/proposals/workspace-guards";
import { assigneeFields, assigneeOptions, assigneeValue } from "@/features/tasks/assignee";
import { todayInbox } from "@/features/today/inbox";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";

/**
 * Wave 3 (2026-09-30): undo for records. Each record here only went one way —
 * an acceptance, a task, a readiness checkpoint, a consultation, a COI
 * request, an archived contact — and a mis-click was permanent.
 */

// ─── 1. Undo an acceptance ────────────────────────────────────────────────

const accepted = {
  proposal: { status: "accepted", acceptancePriorStatus: "viewed", acceptanceAuthority: "studio_attested" },
  projectState: "CONTRACT_PENDING",
  contractStatuses: [] as string[],
  draftStatus: null as string | null,
  standingInvoices: 0,
};

test("an acceptance goes back to exactly where the proposal was", () => {
  const plan = planUndoAcceptance(accepted);
  assert.deepEqual(plan, { ok: true, restoreStatus: "viewed", discardDraft: false, acceptedByCouple: false });
});

test("an acceptance recorded before priorStatus existed is read off the record's dates", () => {
  const base = { ...accepted.proposal, acceptancePriorStatus: undefined };
  const sent = planUndoAcceptance({ ...accepted, proposal: { ...base, sentAt: "2026-09-01T00:00:00Z" } });
  assert.ok(sent.ok && sent.restoreStatus === "sent");
  const viewed = planUndoAcceptance({ ...accepted, proposal: { ...base, sentAt: "x", viewedAt: "y" } });
  assert.ok(viewed.ok && viewed.restoreStatus === "viewed");
  const neither = planUndoAcceptance({ ...accepted, proposal: base });
  assert.ok(neither.ok && neither.restoreStatus === "approved");
});

test("an unsent contract draft prepared on acceptance is discarded with it", () => {
  const plan = planUndoAcceptance({ ...accepted, draftStatus: "draft" });
  assert.ok(plan.ok && plan.discardDraft);
});

test("an agreement out or signed refuses, pointing at withdrawing it first", () => {
  for (const status of ["queued", "sent", "viewed", "completed"]) {
    assert.deepEqual(planUndoAcceptance({ ...accepted, contractStatuses: [status] }), {
      ok: false,
      refusal: "AGREEMENT_OUT_WITHDRAW_FIRST",
    });
  }
  // A withdrawn or superseded one is not in the way.
  assert.ok(planUndoAcceptance({ ...accepted, contractStatuses: ["voided", "superseded", "failed"] }).ok);
});

test("a bill, a job past the agreement, or an acceptance by signing all refuse", () => {
  assert.equal(planUndoAcceptance({ ...accepted, standingInvoices: 1 }).ok, false);
  assert.equal(planUndoAcceptance({ ...accepted, projectState: "RETAINER_PENDING" }).ok, false);
  assert.equal(
    planUndoAcceptance({ ...accepted, proposal: { ...accepted.proposal, acceptedWithContractId: "c1" } }).ok,
    false,
  );
});

test("the couple's own acceptance can be undone, and the page is told it was theirs", () => {
  const plan = planUndoAcceptance({ ...accepted, proposal: { status: "accepted", acceptancePriorStatus: "sent" } });
  assert.ok(plan.ok && plan.acceptedByCouple);
});

test("undo_acceptance is only for an accepted proposal", () => {
  assert.doesNotThrow(() => assertProposalAction("accepted", "undo_acceptance"));
  assert.throws(() => assertProposalAction("sent", "undo_acceptance"));
});

test("the page and the server agree on what 'agreement out' means", () => {
  assert.deepEqual([...ACCEPTANCE_AGREEMENT_OUT].sort(), [...AGREEMENT_OUT].sort());
});

test("both acceptance paths record where the proposal was", () => {
  const proposals = readFileSync("functions/src/booking/proposals.ts", "utf8");
  assert.match(proposals, /acceptancePriorStatus: priorStatus/);
  const portal = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(portal, /acceptancePriorStatus: String\(proposal\.get\("status"\)/);
  const workspace = readFileSync("components/proposals/studio-proposal-workspace.tsx", "utf8");
  assert.match(workspace, /Undo this acceptance/);
});

// ─── 2. Tasks ─────────────────────────────────────────────────────────────

test("a cancelled task can no longer be marked done", () => {
  assert.equal(taskMoveRefusal("cancelled", "complete"), "TASK_CANCELLED");
  assert.equal(taskMoveRefusal("complete", "complete"), "TASK_ALREADY_COMPLETE");
  assert.equal(taskMoveRefusal("completed", "complete"), "TASK_ALREADY_COMPLETE");
  assert.equal(taskMoveRefusal("not_started", "complete"), null);
});

test("done and cancelled tasks reopen; open ones edit and cancel", () => {
  for (const status of ["complete", "completed", "cancelled"]) assert.equal(taskMoveRefusal(status, "reopen"), null);
  assert.equal(taskMoveRefusal("in_progress", "reopen"), "TASK_NOT_SETTLED");
  assert.equal(taskMoveRefusal("in_progress", "cancel"), null);
  assert.equal(taskMoveRefusal("not_started", "update"), null);
  assert.equal(taskMoveRefusal("complete", "update"), "TASK_ALREADY_COMPLETE");
});

test("a task can be for an active studio member or a studio role, nobody else", () => {
  const ok = { tenantId: "t1", status: "active", role: "studio_admin" };
  assert.equal(assigneeRefusal({ assignedUserId: "u1", assignedRole: null, membership: ok, tenantId: "t1" }), null);
  assert.equal(assigneeRefusal({ assignedUserId: null, assignedRole: "studio_coordinator", membership: null, tenantId: "t1" }), null);
  assert.equal(
    assigneeRefusal({ assignedUserId: "u1", assignedRole: null, membership: { ...ok, status: "revoked" }, tenantId: "t1" }),
    "TASK_ASSIGNEE_INVALID",
  );
  assert.equal(
    assigneeRefusal({ assignedUserId: "u1", assignedRole: null, membership: { ...ok, role: "client" }, tenantId: "t1" }),
    "TASK_ASSIGNEE_INVALID",
  );
  assert.equal(
    assigneeRefusal({ assignedUserId: "u1", assignedRole: null, membership: { ...ok, tenantId: "t2" }, tenantId: "t1" }),
    "TASK_ASSIGNEE_INVALID",
  );
  assert.equal(assigneeRefusal({ assignedUserId: null, assignedRole: "crew", membership: null, tenantId: "t1" }), "TASK_ASSIGNEE_INVALID");
});

test("the picker offers active studio members, me, and roles — and round-trips", () => {
  const options = assigneeOptions({
    members: [
      { userId: "a", displayName: "Avery", status: "active", role: "studio_admin" },
      { userId: "c", displayName: "Client", status: "active", role: "client" },
      { userId: "g", displayName: "Gone", status: "revoked", role: "studio_admin" },
    ],
    me: { userId: "me", name: "Gabe" },
  });
  const values = options.map((option) => option.value);
  assert.ok(values.includes("user:a") && values.includes("user:me") && values.includes("role:studio_coordinator"));
  assert.ok(!values.includes("user:c") && !values.includes("user:g"));
  assert.deepEqual(assigneeFields("user:a"), { assignedUserId: "a", assignedRole: null });
  assert.deepEqual(assigneeFields("role:studio_owner"), { assignedUserId: null, assignedRole: "studio_owner" });
  assert.deepEqual(assigneeFields(""), { assignedUserId: null, assignedRole: null });
  assert.equal(assigneeValue({ assignedUserId: "a", assignedRole: "studio_admin" }), "user:a");
  // A coordinator can't read the team, and still gets Me and the roles.
  assert.ok(assigneeOptions({ members: null, me: { userId: "me", name: "Gabe" } }).some((o) => o.value === "user:me"));
});

test("no create path hard-codes who a task is for any more", () => {
  for (const path of [
    "components/workflows/create-task-form.tsx",
    "components/projects/project-thread.tsx",
    "components/ai/actions/studio-actions.tsx",
  ]) {
    assert.match(readFileSync(path, "utf8"), /assigneeFields\(/, path);
  }
});

test("the overdue-task Today card opens the task list for its job, where Mark done is", () => {
  const inbox = todayInbox({
    now: "2026-09-30T12:00:00.000Z",
    projects: [{ id: "p1", tenantId: "t1", name: "Smith wedding", state: "PLANNING", eventDate: "2026-12-01" }],
    tasks: [{ id: "k1", projectId: "p1", title: "Call the venue", dueDate: "2026-09-20", status: "not_started" }],
  } as unknown as Parameters<typeof todayInbox>[0]);
  const card = JSON.stringify(inbox);
  assert.match(card, /Call the venue/, "the overdue task makes a card");
  assert.match(card, /\/studio\/tasks\?project=p1/);
});

test("Mark done offers Undo, and a settled task Reopen", () => {
  const row = readFileSync("components/tasks/task-record-actions.tsx", "utf8");
  for (const needle of ['"reopenTask"', '"cancelTask"', '"updateTask"', "Undo", "Reopen"]) assert.ok(row.includes(needle), needle);
});

// ─── 3. Readiness checkpoints ─────────────────────────────────────────────

test("only a checkpoint a person resolved can be reopened", () => {
  assert.equal(checkpointReopenRefusal("complete"), null);
  assert.equal(checkpointReopenRefusal("waived"), null);
  assert.equal(checkpointReopenRefusal("ready"), "CHECKPOINT_NOT_RESOLVED");
  assert.equal(reopenedCheckpointStatus(true), "ready");
  assert.equal(reopenedCheckpointStatus(false), "not_started");
});

test("reopening a checkpoint is owner/admin on the server", () => {
  const commands = readFileSync("functions/src/workflow/commands.ts", "utf8");
  assert.match(commands, /command\.type === "reopenCheckpoint"\) &&\s*!managerRoles\.includes/);
});

// ─── 4. Consultations ─────────────────────────────────────────────────────

const now = "2026-09-30T12:00:00.000Z";

test("a no-show is only for a booked consultation that has started", () => {
  const base = { move: "no_show" as const, now, projectState: "CONSULTATION" };
  assert.equal(consultationCorrectionRefusal({ ...base, status: "scheduled", startsAt: "2026-09-30T10:00:00Z" }), null);
  assert.equal(
    consultationCorrectionRefusal({ ...base, status: "scheduled", startsAt: "2026-10-02T10:00:00Z" }),
    "CONSULTATION_NOT_STARTED",
  );
  assert.equal(
    consultationCorrectionRefusal({ ...base, status: "completed", startsAt: "2026-09-30T10:00:00Z" }),
    "CONSULTATION_NOT_MARKABLE",
  );
});

test("held or missed reopens while the job is still at the consultation", () => {
  const base = { move: "reopen" as const, now, startsAt: "2026-09-29T10:00:00Z" };
  assert.equal(consultationCorrectionRefusal({ ...base, status: "completed", projectState: "CONSULTATION" }), null);
  assert.equal(consultationCorrectionRefusal({ ...base, status: "no_show", projectState: "LEAD" }), null);
  assert.equal(consultationCorrectionRefusal({ ...base, status: "cancelled", projectState: "CONSULTATION" }), "CONSULTATION_NOT_REOPENABLE");
  assert.equal(consultationCorrectionRefusal({ ...base, status: "completed", projectState: "PROPOSAL" }), "PROJECT_PAST_CONSULTATION");
});

test("reopened in the past waits for notes; in the future it is simply on", () => {
  assert.equal(reopenedConsultationNeedsNotes("2026-09-29T10:00:00Z", now), true);
  assert.equal(reopenedConsultationNeedsNotes("2026-10-05T10:00:00Z", now), false);
});

test("saving notes again does not leave the brief stuck on 'queued'", () => {
  const booking = readFileSync("functions/src/booking/commands.ts", "utf8");
  assert.match(booking, /aiReview: existingJob\.exists\s*\?\s*\(consultation\.get\("aiReview"\)/);
});

test("the calendar keeps held and missed consultations on the day", () => {
  const calendar = readFileSync("components/booking/studio-calendar.tsx", "utf8");
  assert.match(calendar, /\["scheduled", "completed", "no_show"\]/);
  assert.match(calendar, /<ConsultationCorrections/);
});

// ─── 5. Certificates of insurance ─────────────────────────────────────────

test("'not required' cancels every open request and leaves one at the venue alone", () => {
  for (const status of ["prepared", "requested", "correction_required", "under_review", "failed"]) {
    assert.ok(coiRequestIsOpen({ status }), status);
  }
  assert.equal(coiRequestIsOpen({ status: "sent_to_venue" }), false);
  assert.equal(coiRequestIsOpen({ status: "venue_acknowledged" }), false);
  assert.equal(coiRequestIsOpen({ status: "requested", archivedAt: "2026-09-30" }), false);
  const planning = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.match(planning, /coiRequestIsOpen\(insuranceRequest\.data\(\)\)/);
  const chase = readFileSync("functions/src/planning/coi-chase-scheduler.ts", "utf8");
  assert.match(chase, /insuranceRequired"\) === "not_required"/);
});

test("a certificate sent back can still be approved", () => {
  assert.ok(COI_APPROVABLE_STATUSES.includes("correction_required"));
});

test("resending goes to the agent while it is being asked for, and to the venue once sent", () => {
  const agent = planCoiResend({ status: "requested", role: "studio_coordinator", submissionEmail: null, venueDetailsChanged: true, agentEmail: null });
  assert.deepEqual(agent, { ok: true, to: "agent" });
  assert.deepEqual(
    planCoiResend({ status: "requested", role: "studio_owner", submissionEmail: null, venueDetailsChanged: false, agentEmail: null }),
    { ok: false, refusal: "COI_NOTHING_CORRECTED" },
  );
  assert.deepEqual(
    planCoiResend({ status: "sent_to_venue", role: "studio_admin", submissionEmail: "events@venue.com", venueDetailsChanged: false, agentEmail: null }),
    { ok: true, to: "venue" },
  );
  assert.deepEqual(
    planCoiResend({ status: "sent_to_venue", role: "studio_coordinator", submissionEmail: "events@venue.com", venueDetailsChanged: false, agentEmail: null }),
    { ok: false, refusal: "FORBIDDEN" },
  );
  assert.equal(
    planCoiResend({ status: "prepared", role: "studio_owner", submissionEmail: "a@b.co", venueDetailsChanged: true, agentEmail: null }).ok,
    false,
  );
});

test("a corrected resend is what later chases repeat", () => {
  const chase = readFileSync("functions/src/planning/coi-chase-scheduler.ts", "utf8");
  assert.match(chase, /requestEmailJobId/);
});

// ─── 6. Contacts ──────────────────────────────────────────────────────────

test("the client of a lost inquiry can be archived, and an archived client is said to be archived", () => {
  const crm = readFileSync("functions/src/crm/commands.ts", "utf8");
  assert.match(crm, /CONTACT_ARCHIVABLE_PROJECT_STATES = \["CLOSED", "CANCELLED", "ARCHIVED", "LOST"\]/);
  assert.match(crm, /throw new Error\("CONTACT_ARCHIVED"\)/);
});

test("coordinators don't see Edit/Archive, and archived clients are read-only with Restore", () => {
  const actions = readFileSync("components/clients/client-record-actions.tsx", "utf8");
  assert.match(actions, /role !== "studio_owner" && role !== "studio_admin"\) return null/);
  assert.match(actions, /if \(archived\)/);
});

// ─── Every new refusal reads as a sentence ────────────────────────────────

test("every new refusal has copy", () => {
  for (const code of [
    "CONTACT_ARCHIVED", "NO_TASK_CHANGES", "TASK_CANCELLED", "TASK_ALREADY_COMPLETE", "TASK_NOT_SETTLED",
    "TASK_ASSIGNEE_INVALID", "CHECKPOINT_NOT_RESOLVED", "PROPOSAL_NOT_ACCEPTED", "ACCEPTED_BY_SIGNING",
    "PROJECT_PAST_ACCEPTANCE", "AGREEMENT_OUT_WITHDRAW_FIRST", "INVOICE_ALREADY_RAISED",
    "CONSULTATION_NOT_MARKABLE", "CONSULTATION_NOT_STARTED", "CONSULTATION_NOT_REOPENABLE",
    "PROJECT_PAST_CONSULTATION", "COI_NOTHING_CORRECTED", "COI_NOT_RESENDABLE",
  ]) {
    assert.ok(errorCodeHasCopy(code), code);
  }
});
