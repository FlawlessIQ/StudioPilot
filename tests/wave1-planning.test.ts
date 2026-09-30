import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertReopenable,
  assertResendable,
  assertWithdrawable,
  liveAssignmentFor,
  statusAfterSave,
  submittedAtAfterSave,
} from "../functions/src/planning/questionnaire-lifecycle.ts";
import {
  assertStudioMayRecordAnswer,
  revisedTimelineEmail,
  staleVendorShares,
} from "../functions/src/planning/schedule-lifecycle.ts";
import {
  jobPackageSnapshotIds as serverJobPackageSnapshotIds,
  schedulePackageFact,
} from "../functions/src/ai/schedule-package-facts.ts";
import { STUDIO_ACTION_IDS, actionSpec } from "../functions/src/ai/action-catalog.ts";
import {
  couplePackageView,
  currentJobSnapshots,
  jobCoverageMinutes,
  jobPackageSnapshotIds,
} from "@/features/packages/job-packages";
import {
  changedAnswers,
  currentQuestionnaire,
  studioEditableFields,
  studioQuestionnaireActions,
  studioSaveSubmits,
} from "@/features/questionnaires/studio-edit";
import { parseQuestionnaireSections } from "@/features/questionnaires/client-form";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";

/**
 * Planning, as a real studio walks into it (wave 1, 2026-09-30).
 *
 * GR Productions sells photo and video together and is entering planning with
 * its first couple. Each block below is one place that broke for them.
 */

// ─── 1. The questionnaire after it went out ─────────────────────────────────

test("a studio correction to a sent-back form keeps it sent back (the crew-brief trap)", () => {
  // The save that used to reopen the form and delete the crew brief.
  assert.equal(statusAfterSave({ prior: "submitted", submit: false, byClient: false }), "submitted");
  assert.equal(statusAfterSave({ prior: "locked", submit: true, byClient: false }), "locked");
  assert.equal(statusAfterSave({ prior: "submitted", submit: true, byClient: false }), "submitted");
  // The couple's own saves are unchanged.
  assert.equal(statusAfterSave({ prior: "not_started", submit: false, byClient: true }), "in_progress");
  assert.equal(statusAfterSave({ prior: "in_progress", submit: true, byClient: true }), "submitted");
});

test("a reopened form stays reopened while the couple edits, and closes when they send it", () => {
  assert.equal(statusAfterSave({ prior: "reopened", submit: false, byClient: true }), "reopened");
  assert.equal(statusAfterSave({ prior: "reopened", submit: true, byClient: true }), "submitted");
  assert.throws(() => statusAfterSave({ prior: "withdrawn", submit: false, byClient: true }), /QUESTIONNAIRE_WITHDRAWN/);
});

test("the couple's sent-back date survives a studio correction; a resend by the couple dates it again", () => {
  const now = "2026-10-20T10:00:00.000Z";
  const sent = "2026-10-03T09:00:00.000Z";
  assert.equal(submittedAtAfterSave({ nextStatus: "submitted", priorSubmittedAt: sent, byClient: false, now }), sent);
  assert.equal(submittedAtAfterSave({ nextStatus: "submitted", priorSubmittedAt: sent, byClient: true, now }), now);
  assert.equal(submittedAtAfterSave({ nextStatus: "reopened", priorSubmittedAt: sent, byClient: true, now }), sent);
  assert.equal(submittedAtAfterSave({ nextStatus: "in_progress", priorSubmittedAt: null, byClient: true, now }), null);
});

test("reopen, withdraw and resend each apply only where they make sense", () => {
  assert.doesNotThrow(() => assertReopenable("submitted"));
  assert.throws(() => assertReopenable("in_progress"), /QUESTIONNAIRE_NOT_RETURNED/);
  assert.throws(() => assertReopenable("reopened"), /QUESTIONNAIRE_ALREADY_REOPENED/);
  assert.doesNotThrow(() => assertWithdrawable("not_started"));
  assert.doesNotThrow(() => assertWithdrawable("in_progress"));
  // Once sent back — even reopened since — its answers built the crew brief.
  assert.throws(() => assertWithdrawable("submitted"), /QUESTIONNAIRE_NOT_WITHDRAWABLE/);
  assert.throws(() => assertWithdrawable("reopened"), /QUESTIONNAIRE_NOT_WITHDRAWABLE/);
  assert.doesNotThrow(() => assertResendable("reopened"));
  assert.throws(() => assertResendable("submitted"), /QUESTIONNAIRE_ALREADY_RETURNED/);
  assert.throws(() => assertResendable("withdrawn"), /QUESTIONNAIRE_WITHDRAWN/);
});

test("sending the same form again finds the copy they have, by id or by name; a withdrawn one doesn't count", () => {
  const responses = [
    { id: "old", templateId: "t1", templateName: "Wedding details", status: "withdrawn", archivedAt: "2026-09-01" },
    { id: "live", templateId: "t1-v1", templateName: "Wedding details", status: "in_progress", archivedAt: null },
    { id: "other", templateId: "t9", templateName: "Engagement shoot", status: "not_started", archivedAt: null },
  ];
  // Editing a template makes a new version with a new id: matched by name.
  assert.equal(liveAssignmentFor(responses, { id: "t1-v2", name: "Wedding details" })?.id, "live");
  assert.equal(liveAssignmentFor(responses, { id: "t9", name: "Renamed" })?.id, "other");
  assert.equal(liveAssignmentFor(responses, { id: "t5", name: "Family portraits" }), null);
});

test("the studio is offered what applies, and an edit to a sent-back form saves as sent back", () => {
  assert.deepEqual(studioQuestionnaireActions("submitted", true), ["edit", "reopen"]);
  assert.deepEqual(studioQuestionnaireActions("submitted", false), ["edit"]);
  assert.deepEqual(studioQuestionnaireActions("reopened", true), ["edit", "resend"]);
  assert.deepEqual(studioQuestionnaireActions("not_started", true), ["resend", "withdraw"]);
  assert.deepEqual(studioQuestionnaireActions("withdrawn", true), []);
  assert.equal(studioSaveSubmits("submitted"), true);
  assert.equal(studioSaveSubmits("reopened"), false);
  assert.equal(studioSaveSubmits("in_progress"), false);
});

test("a studio edit sends only what changed, and leaves files and people alone", () => {
  assert.deepEqual(
    changedAnswers({ ceremonyTime: "15:00", guests: "120" }, { ceremonyTime: "16:30", guests: "120" }),
    { ceremonyTime: "16:30" },
  );
  const sections = parseQuestionnaireSections([
    {
      id: "s",
      title: "Day",
      fields: [
        { id: "ceremonyTime", label: "Ceremony time", type: "time", required: true },
        { id: "inspiration", label: "Inspiration", type: "file", required: false },
        { id: "planner", label: "Planner", type: "contact", required: false },
      ],
    },
  ]);
  assert.deepEqual(studioEditableFields(sections).map((field) => field.id), ["ceremonyTime"]);
});

test("the job's questionnaire is the live one: withdrawn forms never stand in, a sent-back one wins", () => {
  assert.equal(
    currentQuestionnaire([
      { id: "old", status: "withdrawn", archivedAt: "2026-09-01" },
      { id: "draft", status: "in_progress" },
      { id: "sent", status: "submitted" },
    ])?.id,
    "sent",
  );
  assert.equal(currentQuestionnaire([{ id: "old", status: "withdrawn", archivedAt: "x" }, { id: "new", status: "not_started" }])?.id, "new");
  assert.equal(currentQuestionnaire([{ id: "old", status: "withdrawn", archivedAt: "x" }]), undefined);
});

test("the commands behind it: studio saves are internal-only, reopen is owner/admin, and a same-form assign re-sends", () => {
  const source = readFileSync("functions/src/planning/commands.ts", "utf8");
  const save = source.slice(source.indexOf('parsed.type === "saveQuestionnaire"'));
  assert.match(save.slice(0, 1200), /if \(!byClient && !internalRoles\.has\(role\)\) throw new Error\("FORBIDDEN"\)/);
  assert.match(save.slice(0, 2000), /statusAfterSave\(/);
  const lifecycle = source.slice(source.indexOf('parsed.type === "reopenQuestionnaire" ||'));
  assert.match(lifecycle.slice(0, 800), /parsed\.type === "reopenQuestionnaire"\s*\?\s*!\["studio_owner", "studio_admin"\]/);
  const assign = source.slice(source.indexOf('parsed.type === "assignQuestionnaire"'));
  assert.match(assign.slice(0, 2500), /liveAssignmentFor\(/);
  assert.match(assign.slice(0, 3500), /resent: true/);
});

test("a reopened form keeps the crew brief it had", () => {
  const trigger = readFileSync("functions/src/planning/crew-brief-trigger.ts", "utf8");
  const reopened = trigger.indexOf('"reopened") return;');
  assert.ok(reopened > 0, "the trigger must leave the brief alone while reopened");
  assert.ok(reopened < trigger.indexOf("reference.delete()"), "…before it deletes anything");
});

test("the couple no longer sees a withdrawn questionnaire", () => {
  const portal = readFileSync("app/api/client/portal/route.ts", "utf8");
  assert.match(portal, /collectionName === "questionnaireResponses" &&\s*\(value\.archivedAt \|\| value\.status === "withdrawn"\)/);
});

// ─── 2. A revised timeline reaches the vendors ──────────────────────────────

test("vendor shares behind the current version are found; revoked ones are not", () => {
  const shares = [
    { id: "florist", scheduleId: "v1", status: "acknowledged", vendorContactId: "f" },
    { id: "venue", scheduleId: "v2", status: "sent", vendorContactId: "v" },
    { id: "dj", scheduleId: "v1", status: "revoked", revokedAt: "2026-09-01", vendorContactId: "d" },
  ];
  assert.deepEqual(staleVendorShares(shares, "v2").map((share) => share.id), ["florist"]);
});

test("the re-share email carries the new link and says the old one stopped", () => {
  const email = revisedTimelineEmail({
    projectName: "Chen & Rivera",
    version: 3,
    message: "",
    shareUrl: "https://studio-cue.com/share/abc",
  });
  assert.equal(email.actionUrl, "https://studio-cue.com/share/abc");
  assert.match(email.customSubject, /Chen & Rivera/);
  assert.match(email.customBody, /version 3/);
  assert.match(email.customBody, /earlier link no longer opens/);
  assert.match(revisedTimelineEmail({ projectName: "X", version: 2, message: "Ceremony moved to 4:30.", shareUrl: "u" }).customBody, /^Ceremony moved to 4:30\./);
});

test("archiving a vendor revokes their link; publishing says how many vendors are behind", () => {
  const source = readFileSync("functions/src/planning/commands.ts", "utf8");
  const archive = source.slice(source.indexOf('parsed.type === "archiveVendor"'), source.indexOf('parsed.type === "refreshRunOfShowShares"'));
  assert.match(archive, /revokedReason: "vendor_archived"/);
  assert.match(archive, /if \(!parsed\.input\.restore\)/);
  const publish = source.slice(source.indexOf('} else if (parsed.type === "publishSchedule")'));
  assert.match(publish, /staleVendorShareCount: staleVendorShares\(/);
  const refresh = source.slice(source.indexOf('} else if (parsed.type === "refreshRunOfShowShares")'));
  // Re-uses the one minting path and the ordinary message email.
  assert.match(refresh.slice(0, 5000), /mintRunOfShowShare\(/);
  assert.match(refresh.slice(0, 6000), /type: "manual_message"/);
});

// ─── 3. The couple's answer on the timeline, recorded by the studio ─────────

test("only the version being asked about can take a recorded answer", () => {
  assert.doesNotThrow(() => assertStudioMayRecordAnswer({ status: "published", approvalState: "client_pending" }));
  assert.doesNotThrow(() => assertStudioMayRecordAnswer({ status: "published", approvalState: "changes_requested" }));
  assert.throws(() => assertStudioMayRecordAnswer({ status: "superseded", approvalState: "client_pending" }), /SCHEDULE_SUPERSEDED/);
  assert.throws(() => assertStudioMayRecordAnswer({ status: "published", approvalState: "client_approved" }), /SCHEDULE_ALREADY_APPROVED/);
});

test("the studio's recording needs who, how and when, and crew can't record one", () => {
  const source = readFileSync("functions/src/planning/commands.ts", "utf8");
  const approve = source.slice(source.indexOf("const recorded = role === \"client\""));
  assert.match(approve.slice(0, 1500), /if \(!internalRoles\.has\(role\)\) throw new Error\("FORBIDDEN"\)/);
  assert.match(approve.slice(0, 1500), /SCHEDULE_ANSWER_DETAILS_REQUIRED/);
  assert.match(approve.slice(0, 1500), /newest\.docs\[0\]\?\.id !== current\.id/);
  assert.match(approve, /approvalRecordedByStudio/);
});

// ─── 4. The run-of-show draft knows every package ───────────────────────────

const photo = {
  id: "snap-photo",
  data: {
    packageName: "Gold Photo",
    includedCoverageMinutes: 480,
    includedCoverage: [{ role: "photographer", count: 2 }],
    totalCents: 600000,
    currency: "USD",
  },
};
const video = {
  id: "snap-video",
  data: {
    packageName: "Cinema Film",
    includedCoverageMinutes: 600,
    includedCoverage: [{ role: "videographer", count: 1 }],
    totalCents: 450000,
    currency: "USD",
  },
};

test("the schedule draft is told about both packages, both roles and the longer day", () => {
  const fact = schedulePackageFact([photo, video]);
  assert.ok(fact);
  assert.equal(fact.packageName, "Gold Photo + Cinema Film");
  assert.equal(fact.coverage, "2 photographers and 1 videographer");
  assert.equal(fact.coverageMinutes, 600);
  assert.deepEqual(fact.sourceIds, ["snap-photo", "snap-video"]);
  assert.equal(schedulePackageFact([]), null);
});

test("the job's packages are the job's list, primary first, without repeats — here and in functions/", () => {
  const project = { packageSnapshotId: "a", additionalPackageSnapshotIds: ["b", "a", 7] };
  assert.deepEqual(jobPackageSnapshotIds(project), ["a", "b"]);
  assert.deepEqual(serverJobPackageSnapshotIds(project), ["a", "b"]);
  assert.deepEqual(jobPackageSnapshotIds(null), []);
});

test("the generator's day is the longest package's, and replaced snapshots are ignored", () => {
  const snapshots = [
    { id: "replaced", includedCoverageMinutes: 900 },
    { id: "a", includedCoverageMinutes: 480 },
    { id: "b", includedCoverageMinutes: 600 },
  ];
  const current = currentJobSnapshots(snapshots, { packageSnapshotId: "a", additionalPackageSnapshotIds: ["b"] });
  assert.deepEqual(current.map((snapshot) => snapshot.id), ["a", "b"]);
  assert.equal(jobCoverageMinutes(current), 600);
  assert.equal(jobCoverageMinutes([]), null);
});

// ─── 5. The couple's "Your package" page ────────────────────────────────────

test("the couple sees every package and the accepted proposal's combined total", () => {
  const view = couplePackageView({
    snapshots: [
      { id: "snap-photo", ...photo.data },
      { id: "snap-video", ...video.data },
    ],
    proposals: [
      { status: "superseded", version: 1, pricingSnapshot: { totalCents: 1 }, packageDetails: [] },
      {
        status: "accepted",
        version: 2,
        acceptedAt: "2026-09-20T12:00:00.000Z",
        pricingSnapshot: { totalCents: 1_000_000, currency: "USD" },
        packageDetails: [
          { snapshotId: "snap-photo", packageName: "Gold Photo", items: ["Two photographers all day", "Online gallery"] },
          { snapshotId: "snap-video", packageName: "Cinema Film", items: [] },
        ],
      },
    ],
  });
  assert.ok(view);
  assert.equal(view.fromAcceptedProposal, true);
  // The proposal's combined total (a discount on both), not either package's.
  assert.equal(view.totalCents, 1_000_000);
  assert.deepEqual(view.packages.map((item) => item.name), ["Gold Photo", "Cinema Film"]);
  assert.deepEqual(view.packages[0]!.items, ["Two photographers all day", "Online gallery"]);
  // No bullets on the proposal: the snapshot's own inclusions stand in.
  assert.deepEqual(view.packages[1]!.items, ["10 hours of coverage", "1 videographer"]);
});

test("before a proposal is accepted, the page shows the job's packages and their totals added up", () => {
  const view = couplePackageView({
    snapshots: [
      { id: "snap-photo", ...photo.data },
      { id: "snap-video", ...video.data },
    ],
    proposals: [{ status: "sent", version: 1 }],
  });
  assert.ok(view);
  assert.equal(view.fromAcceptedProposal, false);
  assert.equal(view.totalCents, 1_050_000);
  assert.equal(view.packages.length, 2);
  assert.equal(couplePackageView({ snapshots: [], proposals: [] }), null);
});

test("the portal hands the couple packageDetails and only the job's current snapshots", () => {
  const portal = readFileSync("app/api/client/portal/route.ts", "utf8");
  const proposals = portal.slice(portal.indexOf("const clientRecordFields"), portal.indexOf("packageSnapshots: ["));
  assert.match(proposals, /"packageDetails"/);
  assert.match(portal, /jobPackageSnapshotIds\(project\.data\(\)\)/);
});

// ─── 6. Copy that assumed one package ───────────────────────────────────────

test("copy about what the couple accepted no longer assumes one package", () => {
  for (const [path, stale] of [
    ["components/booking/record-retainer-payment.tsx", /the retainer on the package/],
    ["components/booking/record-final-payment.tsx", /the balance on the package/],
    ["components/ai/actions/planning-actions.tsx", /questionnaire, the package and/],
    ["features/help/explainers.ts", /before they book: the package,|the package they're booking/],
    ["features/help/glossary.ts", /before they book: the package,/],
    ["components/client/kit/client-proposal.tsx", /"Photography proposal"/],
  ] as const) {
    assert.doesNotMatch(readFileSync(path, "utf8"), stale, path);
  }
});

// ─── Cue can do all of it ───────────────────────────────────────────────────

test("Cue can prepare each new planning action, and reopening is owner/admin", () => {
  for (const id of [
    "edit_questionnaire_answers",
    "reopen_questionnaire",
    "withdraw_questionnaire",
    "resend_questionnaire",
    "reshare_run_of_show",
    "record_timeline_approval",
  ])
    assert.ok(STUDIO_ACTION_IDS.has(id), id);
  assert.equal(actionSpec("reopen_questionnaire")?.ownerAdminOnly, true);
});

test("every new refusal has words", () => {
  for (const code of [
    "QUESTIONNAIRE_WITHDRAWN",
    "QUESTIONNAIRE_ALREADY_REOPENED",
    "QUESTIONNAIRE_NOT_RETURNED",
    "QUESTIONNAIRE_NOT_WITHDRAWABLE",
    "QUESTIONNAIRE_ALREADY_RETURNED",
    "SCHEDULE_SUPERSEDED",
    "SCHEDULE_ALREADY_APPROVED",
    "SCHEDULE_ANSWER_DETAILS_REQUIRED",
  ])
    assert.ok(errorCodeHasCopy(code), code);
});
