import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_PLANNING_TIMELINE,
  detailsLockOn,
  detailsLocked,
  planningFormOpensOn,
  resolvePlanningTimeline,
} from "@/features/planning/planning-timeline";
import { lockingFieldIds, locksWithDetails } from "@/features/planning/details-lock";
import { planningFormDue, planningFormTemplate } from "../functions/src/planning/planning-form-scheduler.ts";
import { coupleTimeline, finalDetailsHash } from "../functions/src/planning/final-details.ts";
import { todayInbox } from "@/features/today/inbox";
import { buildClientPortalExperience } from "../server/client/portal-experience.ts";

/**
 * GR Productions (2026-10-02): the planning form six months before (or the
 * studio's pick), the final details locked four weeks before, couples free to
 * change little things, and locations and times after the lock agreed by the
 * studio — at no charge.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the functions copies are identical", () => {
  const imports = (source: string) => source.replace(/(from "[^"]+)\.js"/g, '$1"');
  const strip = (source: string) => imports(source).replace(/\n \* Stored at[\s\S]*?drift\.\n/, "\n");
  assert.equal(strip(read("functions/src/planning/planning-timeline.ts")), strip(read("features/planning/planning-timeline.ts")));
  assert.equal(imports(read("functions/src/planning/details-lock.ts")), read("features/planning/details-lock.ts"));
});

test("the timeline: six months and four weeks unless the studio picks", () => {
  assert.deepEqual(resolvePlanningTimeline(undefined), DEFAULT_PLANNING_TIMELINE);
  assert.deepEqual(resolvePlanningTimeline({ formMonthsBefore: 3, formSend: "auto", formTemplateId: "t1", lockDaysBefore: 21 }), {
    formMonthsBefore: 3,
    formSend: "auto",
    formTemplateId: "t1",
    lockDaysBefore: 21,
    // Off unless a studio turns them on (final-schedule-timing.test.ts).
    formAtBooking: false,
    reviewAtFormDate: false,
    // No shot list unless the studio picks one (tests/shot-list.test.ts).
    shotListTemplateId: null,
    // The final details call is on unless turned off (tests/final-details-call.test.ts).
    finalCall: true,
    // Their own must-take photos, asked four weeks out (tests/client-shot-list.test.ts).
    shotListUpload: true,
    shotListUploadDaysBefore: 28,
  });
  assert.equal(resolvePlanningTimeline({ formMonthsBefore: 30, lockDaysBefore: 2 }).formMonthsBefore, 6);
  assert.equal(resolvePlanningTimeline({ formMonthsBefore: 30, lockDaysBefore: 2 }).lockDaysBefore, 28);
  const timeline = DEFAULT_PLANNING_TIMELINE;
  assert.equal(planningFormOpensOn("2027-06-12", timeline), "2026-12-12");
  assert.equal(planningFormOpensOn("2027-08-31", timeline), "2027-02-28", "the last day of a short month");
  assert.equal(planningFormOpensOn(null, timeline), null);
  assert.equal(detailsLockOn("2027-06-12", timeline), "2027-05-15");
  assert.equal(detailsLocked("2027-06-12", "2027-05-14", timeline), false);
  assert.equal(detailsLocked("2027-06-12", "2027-05-15", timeline), true);
});

test("what locks is where and when; little things stay the couple's", () => {
  const locks = ["Ceremony Location", "Reception Times", "Bride Getting Ready Address", "Photo locations on the way to the hotel", "Ceremony start time"];
  const stays = ["# of Invited Guests", "Planner or coordinator Name and Number", "Groups we must photograph", "Bride Phone", "Anything we should handle carefully"];
  for (const label of locks) assert.equal(locksWithDetails({ label, type: "text" }), true, label);
  for (const label of stays) assert.equal(locksWithDetails({ label, type: "text" }), false, label);
  assert.equal(locksWithDetails({ label: "Ceremony location", type: "file" }), false);
  assert.deepEqual(
    [...lockingFieldIds([{ fields: [{ id: "a", label: "Ceremony Location" }, { id: "b", label: "Guest count" }, { id: "c", label: "Reception address", internalOnly: true }] }])],
    ["a"],
  );
});

test("the scheduler sends only for a studio on automatic, from the day planning opens, never to a quiet job", () => {
  const auto = { ...DEFAULT_PLANNING_TIMELINE, formSend: "auto" as const };
  const job = (fields: Record<string, unknown> = {}) => ({ state: "BOOKED", eventDate: "2027-06-12", eventType: "Wedding", ...fields });
  assert.equal(planningFormDue(job(), auto, "2026-12-12"), true);
  assert.equal(planningFormDue(job(), auto, "2026-12-11"), false, "not yet");
  assert.equal(planningFormDue(job(), DEFAULT_PLANNING_TIMELINE, "2026-12-12"), false, "remind: Today offers it instead");
  assert.equal(planningFormDue(job({ state: "INQUIRY" }), auto, "2026-12-12"), false);
  assert.equal(planningFormDue(job({ clientAutomationsPausedAt: "2026-10-01" }), auto, "2026-12-12"), false);
  assert.equal(planningFormDue(job(), auto, "2027-06-12"), false, "the day itself");
});

test("which form: the studio's choice at its live version, else the newest planning form that isn't the inquiry form", () => {
  const templates = [
    { id: "inq", name: "Wedding Event Info", eventTypeId: "wedding", status: "active", createdAt: "2026-09-01" },
    { id: "plan-v1", name: "Wedding Planning Questionnaire", eventTypeId: "wedding", status: "archived", createdAt: "2026-08-01" },
    { id: "plan-v2", name: "Wedding Planning Questionnaire", eventTypeId: "wedding", status: "active", createdAt: "2026-09-20", supersedesTemplateId: "plan-v1" },
    { id: "venue", name: "Venue Form", eventTypeId: "wedding", status: "active", createdAt: "2026-09-25" },
  ];
  const studio = (formTemplateId: string | null) => ({ timeline: { ...DEFAULT_PLANNING_TIMELINE, formTemplateId }, templates, inquiryFormId: "inq" });
  assert.equal(planningFormTemplate(studio("plan-v1"), "wedding")?.id, "plan-v2", "followed to the live version");
  assert.equal(planningFormTemplate(studio("venue"), "wedding")?.id, "venue");
  assert.equal(planningFormTemplate(studio(null), "wedding")?.id, "plan-v2", "named for planning, not the inquiry form");
});

test("the timeline the couple confirms: theirs, in order, with where", () => {
  const rows = coupleTimeline({
    timezone: "America/New_York",
    items: [
      { title: "Crew arrive", startAt: "2027-06-12T17:00:00Z", visibility: "crew" },
      { title: "Reception", startAt: "2027-06-12T22:00:00Z", visibility: "shared", location: "Harbor View Estate" },
      { title: "Photos at the park", startAt: "2027-06-12T20:30:00Z", visibility: "client", location: "Boathouse Park", address: "1 Lake Rd" },
    ],
  });
  assert.deepEqual(rows, [
    { time: "4:30 PM", title: "Photos at the park", location: "Boathouse Park, 1 Lake Rd" },
    { time: "6:00 PM", title: "Reception", location: "Harbor View Estate" },
  ]);
  const snapshot = { rows: [{ label: "Ceremony", value: "St Mary's" }], timeline: rows, responseIds: [], scheduleId: null, scheduleVersion: null };
  assert.equal(finalDetailsHash(snapshot), finalDetailsHash({ ...snapshot, responseIds: ["x"] }), "the hash is what they read");
  assert.notEqual(finalDetailsHash(snapshot), finalDetailsHash({ ...snapshot, rows: [{ label: "Ceremony", value: "St Paul's" }] }));
});

test("Today: a change to agree, and a sign-off still waiting five days after the lock", () => {
  const now = "2027-05-21T12:00:00.000Z";
  const inbox = todayInbox({
    now,
    projects: [{ id: "p1", name: "Avery & Sam", state: "PLANNING", eventDate: "2027-06-12" }],
    detailChangeRequests: [
      { id: "r1", projectId: "p1", status: "pending", label: "Ceremony start time", fromText: "4:30 PM", toText: "5:00 PM", note: "The priest asked" },
      { id: "r2", projectId: "p1", status: "accepted", label: "Venue" },
    ],
    detailSignoffs: [{ id: "s1", projectId: "p1", status: "awaiting_couple", lockOn: "2027-05-15" }],
  } as never) as unknown as { act: Array<{ id: string; title: string; detail: string; action: { kind: string } }> };
  const change = inbox.act.find((item) => item.id === "detail-change-r1");
  assert.ok(change);
  assert.equal(change!.title, "Avery & Sam want to change Ceremony start time");
  assert.match(change!.detail, /4:30 PM → 5:00 PM · “The priest asked” · .*No charge/);
  assert.equal(change!.action.kind, "detail_change");
  assert.ok(!inbox.act.some((item) => item.id === "detail-change-r2"));
  assert.ok(inbox.act.some((item) => item.id === "final-details-s1"));
  const early = todayInbox({
    now: "2027-05-18T12:00:00.000Z",
    projects: [{ id: "p1", name: "Avery & Sam", state: "PLANNING", eventDate: "2027-06-12" }],
    detailSignoffs: [{ id: "s1", projectId: "p1", status: "awaiting_couple", lockOn: "2027-05-15" }],
  } as never) as unknown as { act: Array<{ id: string }> };
  assert.ok(!early.act.some((item) => item.id === "final-details-s1"), "not before five days");
});

test("the couple's home asks them to approve a published timeline", () => {
  const experience = buildClientPortalExperience({
    state: "PLANNING",
    availability: { schedule: true },
    checkpoints: [],
    currentSchedule: { status: "published", version: 2, approvalState: "client_pending" },
  });
  assert.equal(experience.nextClientAction.name, "Approve your event-day schedule");
  const approved = buildClientPortalExperience({
    state: "PLANNING",
    availability: { schedule: true },
    checkpoints: [],
    currentSchedule: { status: "published", version: 2, approvalState: "client_approved" },
  });
  assert.notEqual(approved.nextClientAction.name, "Approve your event-day schedule");
});

test("wired: the lock is enforced on save, and everything runs and can be read", () => {
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /throw new Error\("DETAILS_LOCKED"\)/);
  assert.match(commands, /const amendingReturned = byClient && isReturned\(priorStatus\);/);
  // Only what they sent back locks: a form not yet returned is still theirs to fill in.
  assert.match(commands, /if \(amendingReturned && changes\.length\) \{\s*const \[projectSnapshot, tenantSnapshot\]/);
  assert.match(read("firestore.rules"), /match \/detailChangeRequests\/\{requestId\} \{\s*allow read: if canManageProjects\(resource\.data\.tenantId\);\s*allow write: if false;/);
  assert.match(read("firestore.rules"), /match \/detailSignoffs\/\{signoffId\} \{\s*allow read: if canManageProjects\(resource\.data\.tenantId\);\s*allow write: if false;/);
  for (const name of ["planningFormScheduler", "finalDetailsScheduler"]) assert.match(read("functions/src/index.ts"), new RegExp(name));
  for (const name of ["planningformscheduler", "finaldetailsscheduler"]) assert.match(read("scripts/configure-production-function-invokers.sh"), new RegExp(name));
  assert.match(read("functions/src/planning/final-details.ts"), /if \(clientOutreachStop\(data\)\) continue;/);
});
