import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  waitingLine,
  waitingStatusLabel,
  withdrawAllConsequence,
} from "@/features/crew/withdraw-copy";
import { archiveBlockedBy } from "@/features/crew/job-stopped";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";
import {
  waitingCrew,
  withdrawJobCrew,
  type JobCrewRead,
} from "../functions/src/crew/withdraw-for-job.js";

/**
 * "I tried to delete [the] job to restart and won't let me … They say I have
 * an offer out." — GR Productions, 2026-10-01.
 *
 * Deleting (and archiving) a job with somebody still waiting on it was refused
 * with one sentence that named nobody and offered nothing to press. The
 * preview now says who is waiting, and one button withdraws them and deletes
 * the job in a single server command.
 */

// --- fakes: just enough of a snapshot for the pure write plan --------------

type Fields = Record<string, unknown>;
const doc = (path: string, fields: Fields | null) => ({
  id: path.split("/").at(-1)!,
  exists: fields !== null,
  ref: { path },
  get: (field: string) => (fields ?? {})[field],
});
const db = { doc: (path: string) => ({ path }) };

function readOf(assignments: Array<{ id: string } & Fields>, extra: Partial<JobCrewRead> = {}): JobCrewRead {
  const all = assignments.map((item) => doc(`crewAssignments/${item.id}`, item));
  const live = all.filter((item) =>
    ["draft", "invited", "viewed", "accepted"].includes(String(item.get("status"))),
  );
  return {
    all,
    live,
    profiles: new Map(),
    calendarEvents: new Map(),
    activeCascadeIds: [],
    memberships: new Map(),
    ...extra,
  } as unknown as JobCrewRead;
}

function recordingWriter() {
  const writes: Array<{ op: "update" | "set"; path: string; data: Fields }> = [];
  return {
    writes,
    writer: {
      update: (reference: { path: string }, data: Fields) => writes.push({ op: "update", path: reference.path, data }),
      set: (reference: { path: string }, data: Fields) => writes.push({ op: "set", path: reference.path, data }),
    },
  };
}

const base = {
  tenantId: "t1",
  projectId: "p1",
  projectName: "Smith Wedding",
  actorId: "owner",
  now: "2026-10-01T12:00:00.000Z",
};

const crew = [
  {
    id: "a-accepted",
    tenantId: "t1",
    projectId: "p1",
    status: "accepted",
    role: "Second shooter",
    crewProfileId: "alex",
    userId: "u-alex",
    arrivalAt: "2026-11-07T15:00:00.000Z",
    departureAt: "2026-11-08T01:00:00.000Z",
    calendarEventId: "gcal-1",
  },
  { id: "a-invited", tenantId: "t1", projectId: "p1", status: "invited", role: "Videographer", crewProfileId: "sam" },
  { id: "a-draft", tenantId: "t1", projectId: "p1", status: "draft", role: "Assistant", crewProfileId: "" },
  { id: "a-declined", tenantId: "t1", projectId: "p1", status: "declined", role: "Assistant", crewProfileId: "" },
];
const profiles = new Map([
  ["alex", doc("crewProfiles/alex", { tenantId: "t1", name: "Alex Rivera", email: "alex@example.com" })],
  ["sam", doc("crewProfiles/sam", { tenantId: "t1", name: "Sam Lee", email: "sam@example.com" })],
]);

// --- who is waiting ----------------------------------------------------------

test("the preview names who is waiting and where things stand", () => {
  const waiting = waitingCrew(readOf(crew, { profiles } as Partial<JobCrewRead>));
  assert.deepEqual(
    waiting.map((member) => [member.name, member.role, member.status]),
    [
      ["Alex Rivera", "Second shooter", "accepted"],
      ["Sam Lee", "Videographer", "invited"],
      // No directory entry: the role stands in for the name.
      [null, "Assistant", "draft"],
    ],
  );
  assert.deepEqual(waiting.map(waitingLine), [
    "Alex Rivera (Second shooter) — accepted",
    "Sam Lee (Videographer) — offer not answered",
    "Assistant — drafted, not sent",
  ]);
});

test("every live status has a plain label", () => {
  assert.equal(waitingStatusLabel("accepted"), "accepted");
  assert.equal(waitingStatusLabel("invited"), "offer not answered");
  assert.equal(waitingStatusLabel("viewed"), "offer not answered");
  assert.equal(waitingStatusLabel("draft"), "drafted, not sent");
});

test("the confirm says who is emailed and who is not", () => {
  const sentence = withdrawAllConsequence([
    { name: "Alex Rivera", role: "Second shooter", status: "accepted" },
    { name: "Sam Lee", role: "Videographer", status: "invited" },
    { name: null, role: "Assistant", status: "draft" },
  ]);
  assert.match(sentence, /Alex Rivera already said yes, so they're emailed that they've been released/);
  assert.match(sentence, /calendar file/);
  assert.match(sentence, /Sam Lee and your assistant haven't said yes, so they aren't emailed/);
});

test("the archive refusal shows the rule's own specific wording", () => {
  const block = archiveBlockedBy([{ status: "invited", role: "Videographer" }]);
  assert.match(String(block.message), /still has videographer waiting on it/);
});

// --- the withdrawal, exactly as withdrawing one person ----------------------

test("accepted crew are emailed the release with a calendar file; unanswered offers just close", () => {
  const { writes, writer } = recordingWriter();
  const outcome = withdrawJobCrew(writer, db as never, readOf(crew, { profiles } as Partial<JobCrewRead>), {
    ...base,
    reason: "Job deleted by the studio",
    jobDeleted: true,
  });
  assert.deepEqual(outcome.withdrawn, ["a-accepted", "a-invited", "a-draft"]);
  assert.deepEqual(outcome.notified, ["a-accepted"]);

  const assignmentUpdates = writes.filter((write) => write.path.startsWith("crewAssignments/"));
  assert.equal(assignmentUpdates.length, 3, "the declined one is left alone");
  for (const write of assignmentUpdates) {
    assert.equal(write.data.status, "cancelled");
    assert.equal(write.data.cancelledReason, "Job deleted by the studio");
    assert.equal(write.data.withdrawnByStudio, true);
  }

  const emails = writes.filter((write) => write.path.startsWith("emailJobs/"));
  assert.equal(emails.length, 1, "only the person who said yes is emailed");
  const email = emails[0]!.data;
  assert.equal(email.type, "crew_assignment_cancelled");
  assert.equal(email.cause, "withdrawn");
  assert.equal(email.recipient, "alex@example.com");
  assert.equal(email.projectName, "Smith Wedding");
  assert.match(String((email.calendarAttachment as Fields).content), /STATUS:CANCELLED/);
});

test("on a delete, nothing queued carries the projectId the sweep matches on", () => {
  const { writes, writer } = recordingWriter();
  withdrawJobCrew(writer, db as never, readOf(crew, { profiles } as Partial<JobCrewRead>), {
    ...base,
    reason: "Job deleted by the studio",
    jobDeleted: true,
  });
  const queued = writes.filter((write) => /^(emailJobs|providerJobs)\//.test(write.path));
  assert.equal(queued.length, 2, "the release email and the Google invite removal");
  for (const write of queued) {
    assert.equal(write.data.projectId, null, `${write.path} would be swept before it ran`);
    assert.equal(write.data.deletedProjectId, "p1");
  }
  const calendar = queued.find((write) => write.path.startsWith("providerJobs/"))!;
  assert.equal(calendar.data.type, "remove_crew_calendar_invite");
  // The assignment is gone by the time the worker runs.
  assert.equal(calendar.data.calendarEventId, "gcal-1");
});

test("on an archive the job is still there, so the queued work points at it", () => {
  const { writes, writer } = recordingWriter();
  withdrawJobCrew(writer, db as never, readOf(crew, { profiles } as Partial<JobCrewRead>), {
    ...base,
    reason: "Job archived by the studio",
    jobDeleted: false,
  });
  for (const write of writes.filter((item) => /^(emailJobs|providerJobs)\//.test(item.path)))
    assert.equal(write.data.projectId, "p1");
});

test("no address, no mail — never the couple", () => {
  const { writes, writer } = recordingWriter();
  const outcome = withdrawJobCrew(writer, db as never, readOf([crew[0]!]), {
    ...base,
    reason: "Job deleted by the studio",
    jobDeleted: true,
  });
  assert.deepEqual(outcome.notified, []);
  assert.equal(writes.filter((write) => write.path.startsWith("emailJobs/")).length, 0);
});

test("a cascade still working its list is stopped, and the job closes to a subcontractor", () => {
  const { writes, writer } = recordingWriter();
  const memberships = new Map([
    ["u-alex", doc("memberships/t1_u-alex", { role: "subcontractor" })],
  ]);
  withdrawJobCrew(
    writer,
    db as never,
    readOf(crew, { profiles, memberships, activeCascadeIds: ["c1"] } as Partial<JobCrewRead>),
    { ...base, reason: "Job deleted by the studio", jobDeleted: true },
  );
  assert.equal(writes.find((write) => write.path === "crewCascades/c1")?.data.status, "exhausted");
  assert.ok(writes.some((write) => write.path === "memberships/t1_u-alex"));
});

// --- the wiring ------------------------------------------------------------

const purge = readFileSync(`${process.cwd()}/functions/src/projects/purge-command.ts`, "utf8");
const crm = readFileSync(`${process.cwd()}/functions/src/crm/commands.ts`, "utf8");
const panel = readFileSync(`${process.cwd()}/components/projects/delete-job-permanently.tsx`, "utf8");
const runtime = readFileSync(`${process.cwd()}/functions/src/operations/provider-runtime.ts`, "utf8");

test("the preview answers with who is waiting instead of refusing", () => {
  const preview = purge.slice(purge.indexOf('parsed.type === "previewProjectPurge"'));
  assert.match(preview.slice(0, 2000), /waitingCrew\(/);
  assert.match(preview.slice(0, 3000), /waiting,/);
  const authorise = purge.slice(purge.indexOf("async function authorise"), purge.indexOf("/** One page of this job"));
  assert.doesNotMatch(authorise, /PROJECT_HAS_LIVE_CREW/);
});

test("the plain path still refuses live crew; withdrawing is an explicit choice", () => {
  assert.match(purge, /withdrawLiveCrew: z\.boolean\(\)\.default\(false\)/);
  assert.match(purge, /if \(liveCrew && !parsed\.input\.withdrawLiveCrew\)\s*throw new Error\("PROJECT_HAS_LIVE_CREW"\)/);
});

test("withdrawing happens after the typed name is checked and before anything is destroyed", () => {
  const nameCheck = purge.indexOf("purgeConfirmationMatches(parsed.input.confirmation");
  const withdraw = purge.indexOf("withdrawJobCrew(transaction");
  const sweep = purge.indexOf("await sweepProjectRecords(");
  assert.ok(nameCheck > 0 && withdraw > nameCheck, "withdraw only once the name matches");
  assert.ok(sweep > withdraw, "withdraw before the sweep");
  assert.match(purge, /reason: JOB_DELETED_REASON,\s*jobDeleted: true/);
  assert.match(purge, /JOB_DELETED_REASON = "Job deleted by the studio"/);
});

test("archive offers the same withdrawal, in its own transaction", () => {
  const archive = crm.slice(crm.indexOf('if (command.type === "archiveProject")'));
  assert.match(archive.slice(0, 4000), /!command\.input\.withdrawLiveCrew/);
  assert.match(archive.slice(0, 5000), /readJobCrew\(\s*transaction/);
  assert.match(archive.slice(0, 5000), /reason: "Job archived by the studio"/);
});

test("the Google invite comes back even once the assignment is gone", () => {
  const remove = runtime.slice(runtime.indexOf("export async function removeCrewCalendarInvite"));
  assert.match(remove.slice(0, 2500), /deletedWithJob/);
});

test("the panel keeps the typed name and second press, and names its one button", () => {
  assert.match(panel, /disabled=\{!nameMatches\}/);
  assert.match(panel, /Withdraw these and delete the job/);
  assert.match(panel, /withdrawLiveCrew: waiting\.length > 0/);
  assert.match(panel, /waitingLine\(member\)/);
  assert.match(panel, /withdrawAllConsequence\(waiting\)/);
  // The plain path is unchanged when nobody is waiting.
  assert.match(panel, /Delete this job and everything in it/);
});

test("the archive control lists who and offers Withdraw these and archive", () => {
  const control = readFileSync(`${process.cwd()}/components/projects/archive-job-with-crew.tsx`, "utf8");
  assert.match(control, /archiveBlockedBy\(waiting\)/);
  assert.match(control, /Withdraw these and archive/);
  assert.match(control, /withdrawLiveCrew: true/);
});

test("the bulk tenant purge is untouched: it still imports the same three helpers", () => {
  const script = readFileSync(`${process.cwd()}/scripts/purge-tenant-jobs.ts`, "utf8");
  assert.match(script, /contactsToDelete,\s*manifest,\s*sweepProjectRecords,/);
  for (const name of ["contactsToDelete", "manifest", "sweepProjectRecords"])
    assert.match(purge, new RegExp(`export async function ${name}\\(`));
  assert.doesNotMatch(script, /withdrawLiveCrew|withdrawJobCrew/);
});

test("the refusal still has copy, and it no longer dead-ends", () => {
  assert.equal(errorCodeHasCopy("PROJECT_HAS_LIVE_CREW"), true);
  const friendly = readFileSync(`${process.cwd()}/lib/ai/friendly-error.ts`, "utf8");
  const line = friendly.slice(friendly.indexOf("PROJECT_HAS_LIVE_CREW:"), friendly.indexOf("PROJECT_HAS_LIVE_CREW:") + 400);
  assert.match(line, /withdraw them/);
});
