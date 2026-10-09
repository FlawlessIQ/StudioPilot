import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { shotListDueDate, shotListRequestDue } from "../functions/src/planning/shot-list-upload.ts";
import { resolvePlanningTimeline } from "../functions/src/planning/planning-timeline.ts";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import {
  isOwnShotListPath,
  shotListContentType,
  shotListNeedsStudio,
  shotListStatus,
} from "@/features/planning/shot-list";
import { todayInbox } from "@/features/today/inbox";
import { buildClientPortalExperience } from "../server/client/portal-experience.ts";
import { editableEmailsFor } from "@/features/communications/email-catalog";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const timeline = resolvePlanningTimeline(null);
const wedding = { id: "p1", tenantId: "t1", state: "PLANNING", eventDate: "2027-06-12", eventKind: "wedding" };

test("asked four weeks out by default, at photo studios, for booked weddings only", () => {
  assert.equal(timeline.shotListUpload, true);
  assert.equal(timeline.shotListUploadDaysBefore, 28);
  const due = (project: Record<string, unknown>, today: string, trade: unknown = "photographer", t = timeline) =>
    shotListRequestDue({ project, timeline: t, trade, today });
  assert.equal(due(wedding, "2027-05-14"), false, "a day early");
  assert.equal(due(wedding, "2027-05-15"), true, "28 days before");
  assert.equal(due(wedding, "2027-06-11"), true, "late, but before the day");
  assert.equal(due(wedding, "2027-06-12"), false, "never on the day");
  assert.equal(due({ ...wedding, state: "PROPOSAL" }, "2027-05-20"), false, "not booked");
  assert.equal(due({ ...wedding, eventKind: "family" }, "2027-05-20"), false, "weddings only");
  assert.equal(due({ ...wedding, importedAt: "2026-01-01" }, "2027-05-20"), false, "imported stays quiet");
  assert.equal(due({ ...wedding, clientAutomationsPausedAt: "2027-05-01" }, "2027-05-20"), false, "paused stays quiet");
  assert.equal(due(wedding, "2027-05-20", "dj"), false, "a DJ has no shot list");
  assert.equal(due(wedding, "2027-05-20", "photographer", { ...timeline, shotListUpload: false }), false, "turned off");
  assert.equal(due(wedding, "2027-05-01", "photographer", { ...timeline, shotListUploadDaysBefore: 42 }), true, "six weeks");
  assert.equal(resolvePlanningTimeline({ shotListUploadDaysBefore: 400 }).shotListUploadDaysBefore, 28, "out of range falls back");
});

test("due two weeks before the day, or not at all once that has passed", () => {
  assert.equal(shotListDueDate("2027-06-12", "2027-05-15"), "2027-05-29");
  assert.equal(shotListDueDate("2027-06-12", "2027-06-01"), null);
});

test("the couple's files: their own folder, the types the scanner takes", () => {
  const who = { tenantId: "t1", projectId: "p1", uid: "u1" };
  assert.ok(isOwnShotListPath("tenants/t1/projects/p1/clients/u1/shot-list/abc-list.pdf", who));
  assert.ok(!isOwnShotListPath("tenants/t1/projects/p1/clients/u2/shot-list/abc-list.pdf", who), "another couple's");
  assert.ok(!isOwnShotListPath("tenants/t1/projects/p2/clients/u1/shot-list/abc-list.pdf", who), "another job");
  assert.ok(!isOwnShotListPath("tenants/t1/projects/p1/clients/u1/shot-list/../x/list.pdf", who));
  assert.ok(!isOwnShotListPath("tenants/t1/projects/p1/clients/u1/shot-list/", who));
  assert.equal(shotListContentType({ type: "", name: "Our list.DOCX" }), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(shotListContentType({ type: "image/png", name: "x" }), "image/png");
  assert.equal(shotListContentType({ type: "application/zip", name: "x.zip" }), null);
});

test("new on Today until the studio opens it; a later send puts it back", () => {
  const sent = { status: "received", files: [{ storagePath: "a", name: "a.pdf", contentType: "application/pdf", sizeBytes: 1, uploadedAt: "x" }], receivedAt: "2027-05-20T10:00:00Z" };
  assert.equal(shotListStatus(null), "not_requested");
  assert.equal(shotListStatus({ status: "requested" }), "requested");
  assert.equal(shotListStatus(sent), "received");
  assert.ok(shotListNeedsStudio(sent));
  assert.ok(!shotListNeedsStudio({ ...sent, studioSeenAt: "2027-05-20T11:00:00Z" }));
  assert.ok(shotListNeedsStudio({ ...sent, studioSeenAt: "2027-05-19T11:00:00Z" }), "added to since");
  assert.ok(!shotListNeedsStudio({ status: "requested", receivedAt: null }));

  const inbox = todayInbox({
    now: "2027-05-21T12:00:00.000Z",
    projects: [{ id: "p1", name: "Avery & Sam", state: "PLANNING", eventDate: "2027-06-12" }],
    clientShotLists: [{ id: "p1", projectId: "p1", ...sent, note: "Grandma Rose with all the grandkids" }],
  } as never) as unknown as { act: Array<{ id: string; title: string; detail: string; jobHref: string; action: { kind: string } }> };
  const item = inbox.act.find((entry) => entry.id === "shot-list-p1");
  assert.ok(item);
  assert.equal(item!.title, "Avery & Sam sent their shot list");
  assert.match(item!.detail, /^1 file · “Grandma Rose with all the grandkids”/);
  assert.equal(item!.action.kind, "shot_list");
  const seen = todayInbox({
    now: "2027-05-21T12:00:00.000Z",
    projects: [{ id: "p1", name: "Avery & Sam", state: "PLANNING", eventDate: "2027-06-12" }],
    clientShotLists: [{ id: "p1", projectId: "p1", ...sent, studioSeenAt: "2027-05-21T09:00:00Z" }],
  } as never) as unknown as { act: Array<{ id: string }> };
  assert.ok(!seen.act.some((entry) => entry.id === "shot-list-p1"));
});

test("the couple's portal: asked for, it's their next step; sent, it isn't", () => {
  const asked = buildClientPortalExperience({ state: "PLANNING", availability: {}, checkpoints: [], shotList: { status: "requested", dueDate: "2027-05-29" } } as never);
  assert.equal(asked.navigation.shotList, true);
  assert.equal(asked.nextClientAction.href, "/client/shot-list");
  const sent = buildClientPortalExperience({ state: "PLANNING", availability: {}, checkpoints: [], shotList: { status: "received", dueDate: null } } as never);
  assert.notEqual(sent.nextClientAction.href, "/client/shot-list");
});

test("the email: a link that opens the page, quiet for imported bookings, editable at photo studios only", () => {
  const email = renderEmailTemplate({
    key: "shot_list_request",
    brand: { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Avery",
    projectName: "Avery & Sam",
    values: { dueDate: "2027-05-29", actionUrl: "https://studio-cue.com/client/shot-list" },
  } as Parameters<typeof renderEmailTemplate>[0]);
  assert.match(email.subject, /must-take photos/);
  assert.match(email.html, /href="https:\/\/studio-cue\.com\/client\/shot-list"/);
  assert.ok(clientAutomationEmailTypes.includes("shot_list_request"));
  assert.ok(editableEmailsFor("photographer").some((entry) => entry.key === "shot_list_request"));
  assert.ok(!editableEmailsFor("dj").some((entry) => entry.key === "shot_list_request"));
});

test("wired: asked by the day's sweep, saved through the portal, readable by the studio only", () => {
  assert.match(read("functions/src/planning/planning-form-scheduler.ts"), /requestShotListIfDue\(/);
  assert.match(read("app/api/client/portal/route.ts"), /submit_shot_list/);
  assert.match(read("firestore.rules"), /match \/clientShotLists\/\{projectId\} \{\s*allow read: if canManageProjects\(resource\.data\.tenantId\);\s*allow write: if false;/);
  assert.match(read("storage.rules"), /clients\/\{userId\}\/shot-list\/\{fileName\}/);
  assert.match(read("components/live/tenant-records.tsx"), /"clientShotLists"/);
  assert.match(read("components/projects/live-project-detail.tsx"), /<ProjectShotList/);
});
