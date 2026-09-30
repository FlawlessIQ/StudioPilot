import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  crewDemand,
  jobCoverage,
  jobPackageSnapshotIds,
} from "@/features/crew/staffing-plan";
import { withdrawalPlan } from "@/features/crew/withdraw";
import {
  withdrawConsequence,
  withdrawDoneMessage,
  withdrawOutcome,
} from "@/features/crew/withdraw-copy";
import { readinessEvidenceFromFacts } from "@/features/readiness/checkpoint-evidence";
import { projectJourney } from "@/features/journey/steps";
import { describeProviderFailure } from "@/features/today/provider-failure";
import { ARCHIVE_REFUSALS } from "@/features/records/archive";
import { friendlyError } from "@/lib/ai/friendly-error";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { assignmentIcs } from "../functions/src/crew/calendar-ics.ts";
import { STUDIO_ACTIONS } from "../functions/src/ai/action-catalog.ts";

/**
 * Wave 1 crew fixes, for GR Productions' first wedding (2026-09-30).
 *
 * GR sells photography and video together, so a job carries two packages. The
 * crew requirement read the primary package's photographers alone, and there
 * was no way to take one person off a job short of cancelling the wedding.
 */

const read = (path: string) =>
  readFileSync(`${process.cwd()}/${path}`, "utf8");

// A photo package sending two photographers, and a video package sending one
// videographer, as two snapshots on one job.
const photoSnapshot = {
  id: "snap-photo",
  includedCoverage: [{ role: "photographer", count: 2 }],
  includedPhotographers: 2,
};
const videoSnapshot = {
  id: "snap-video",
  includedCoverage: [{ role: "videographer", count: 1 }],
  includedPhotographers: 0,
};
const photoAndVideo = jobCoverage([photoSnapshot, videoSnapshot]);

// --- 2. videographers are counted -------------------------------------------

test("a job's snapshots are the primary and every added one, once each", () => {
  assert.deepEqual(
    jobPackageSnapshotIds({
      packageSnapshotId: "snap-photo",
      additionalPackageSnapshotIds: ["snap-video", "snap-photo", "", 7],
    }),
    ["snap-photo", "snap-video"],
  );
  assert.deepEqual(jobPackageSnapshotIds({}), []);
  assert.deepEqual(jobPackageSnapshotIds(null), []);
});

test("no package is no coverage, not a phantom photographer", () => {
  assert.deepEqual(jobCoverage([]), []);
  assert.equal(crewDemand({ coverage: [], assignments: [] }).crewRequired, 0);
});

test("photo + video needs its videographer: two crew to book, one of them video", () => {
  const demand = crewDemand({ coverage: photoAndVideo, assignments: [] });
  assert.equal(demand.crewRequired, 2);
  assert.equal(demand.packageNeedsCrew, true);
  assert.deepEqual(
    demand.open.map((role) => role.coverageRole).sort(),
    ["photographer", "videographer"],
  );
  // The primary package alone — what every reader used to use — said one.
  assert.equal(
    crewDemand({ coverage: jobCoverage([photoSnapshot]), assignments: [] })
      .crewRequired,
    1,
  );
});

test("a second photographer's yes does not settle the videographer's role", () => {
  const demand = crewDemand({
    coverage: photoAndVideo,
    assignments: [
      { status: "accepted", role: "Second photographer" },
      // Hired beyond the package: counts as required, never as the video.
      { status: "accepted", role: "Photographer 3" },
    ],
  });
  assert.equal(demand.crewAccepted, 2);
  assert.equal(demand.crewRequired, 3);
  assert.deepEqual(demand.open.map((role) => role.coverageRole), ["videographer"]);
  const evidence = readinessEvidenceFromFacts({
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: null,
    questionnaireStatus: null,
    questionnaireAnswers: null,
    scheduleStatus: null,
    scheduleItems: [],
    crewAccepted: demand.crewAccepted,
    crewRequired: demand.crewRequired,
    crewAcknowledgedCurrent: demand.crewAcknowledgedCurrent,
    coiStatus: null,
    insuranceRequired: "not_required",
  });
  assert.equal(evidence.crewAccepted, false);
});

test("with both trades accepted, crew is confirmed", () => {
  const demand = crewDemand({
    coverage: photoAndVideo,
    assignments: [
      { status: "accepted", role: "Second photographer", acknowledgedScheduleVersion: 3 },
      { status: "accepted", role: "Videographer", acknowledgedScheduleVersion: 2 },
    ],
    scheduleVersion: 3,
  });
  assert.equal(demand.crewAccepted, 2);
  assert.equal(demand.crewRequired, 2);
  // Only the one who read the current version.
  assert.equal(demand.crewAcknowledgedCurrent, 1);
  assert.deepEqual(demand.open, []);
});

test("declined, expired and withdrawn offers are history, not roles to fill", () => {
  const demand = crewDemand({
    coverage: jobCoverage([photoSnapshot]),
    assignments: [
      { status: "declined", role: "Second photographer" },
      { status: "expired", role: "Second photographer" },
      { status: "cancelled", role: "Second photographer" },
      { status: "accepted", role: "Second photographer" },
    ],
  });
  // The server used to take all four as the requirement: 1 of 4, never ready.
  assert.equal(demand.crewRequired, 1);
  assert.equal(demand.crewAccepted, 1);
});

test("the journey rail agrees: photo + video with only photographers is not done", () => {
  const demand = crewDemand({
    coverage: photoAndVideo,
    assignments: [{ status: "accepted", role: "Second photographer" }],
  });
  const journey = projectJourney({
    projectId: "p1",
    state: "PLANNING",
    crewAccepted: demand.crewAccepted,
    crewRequired: demand.crewRequired,
    packageNeedsSecondShooter: demand.packageNeedsCrew,
    packageChosen: true,
  } as Parameters<typeof projectJourney>[0]);
  const crew = journey.steps.find((step) => step.key === "crew");
  assert.ok(crew);
  assert.notEqual(crew.status, "complete");
});

test("server readiness reads every package through the same helper", () => {
  for (const path of [
    "functions/src/workflow/readiness-evidence-loader.ts",
    "functions/src/workflow/commands.ts",
  ]) {
    const source = read(path);
    assert.match(source, /crewDemand\(/, path);
    assert.match(source, /jobPackageSnapshotIds\(/, path);
    assert.doesNotMatch(source, /crewRequired: crew(Snapshot)?\.size/, path);
  }
  for (const path of [
    "components/projects/use-readiness-evidence.ts",
    "components/projects/use-project-journey.ts",
    "components/today/use-today-inbox.ts",
  ]) {
    const source = read(path);
    assert.match(source, /crewDemand\(/, path);
    assert.match(source, /jobPackageSnapshotIds\(/, path);
  }
});

// --- 3. the manual crew plan offers the videographer -------------------------

test("the manual crew plan suggests roles from every package, not the primary", () => {
  const source = read("components/crew/crew-cascade-workspace.tsx");
  assert.match(source, /jobPackageSnapshotIds\(project\)/);
  assert.match(source, /crewDemand\(/);
  // The fallback that could pick a snapshot a booking change had replaced.
  assert.doesNotMatch(source, /snapshot\.projectId === projectId/);
  // And what it will suggest for GR's job, with the second shooter booked.
  assert.deepEqual(
    crewDemand({
      coverage: photoAndVideo,
      assignments: [{ status: "invited", role: "Second photographer" }],
    }).open.map((role) => role.role),
    ["Videographer"],
  );
});

// --- 1. withdraw / replace ----------------------------------------------------

const filledCascade = {
  status: "filled",
  currentAssignmentId: "c1_offer_1",
  acceptedAssignmentId: "c1_offer_1",
  currentCandidateIndex: 0,
  candidateIds: ["sam", "alex", "jo"],
};

test("only live work can be withdrawn", () => {
  for (const status of ["declined", "expired", "cancelled", "completed", "reassigned"])
    assert.deepEqual(
      withdrawalPlan({ assignmentId: "a", status, replace: false, cascade: null }),
      { withdrawable: false, code: "ASSIGNMENT_NOT_WITHDRAWABLE" },
      status,
    );
});

test("someone who accepted is told; someone who never answered is not", () => {
  const accepted = withdrawalPlan({ assignmentId: "a", status: "accepted", replace: false, cascade: null });
  const invited = withdrawalPlan({ assignmentId: "a", status: "invited", replace: false, cascade: null });
  assert.ok(accepted.withdrawable && accepted.notify);
  assert.ok(invited.withdrawable && !invited.notify);
});

test("replace moves the cascade on to the next person on the studio's list", () => {
  const plan = withdrawalPlan({
    assignmentId: "c1_offer_1",
    status: "accepted",
    replace: true,
    cascade: filledCascade,
  });
  assert.ok(plan.withdrawable);
  assert.deepEqual(plan.cascade, {
    action: "advance",
    fromIndex: 1,
    candidateIds: ["alex", "jo"],
  });
});

test("replace with nobody left, or a plain withdraw, closes the slot", () => {
  const last = withdrawalPlan({
    assignmentId: "c1_offer_3",
    status: "invited",
    replace: true,
    cascade: { ...filledCascade, status: "active", currentAssignmentId: "c1_offer_3", currentCandidateIndex: 2 },
  });
  assert.ok(last.withdrawable);
  assert.deepEqual(last.cascade, { action: "close" });
  const plain = withdrawalPlan({
    assignmentId: "c1_offer_1",
    status: "accepted",
    replace: false,
    cascade: filledCascade,
  });
  assert.ok(plain.withdrawable);
  assert.deepEqual(plain.cascade, { action: "close" });
});

test("a cascade that has moved past this offer is left alone", () => {
  const plan = withdrawalPlan({
    assignmentId: "c1_offer_1",
    status: "invited",
    replace: true,
    cascade: { ...filledCascade, status: "active", currentAssignmentId: "c1_offer_2", acceptedAssignmentId: null },
  });
  assert.ok(plan.withdrawable);
  assert.deepEqual(plan.cascade, { action: "none" });
});

test("the confirm step names the person and says whether they are emailed", () => {
  const booked = withdrawConsequence({ name: "Sam Reed", role: "Videographer", accepted: true, replace: false });
  assert.match(booked, /Sam Reed/);
  assert.match(booked, /is emailed/);
  const offered = withdrawConsequence({ name: "Sam Reed", role: "Videographer", accepted: false, replace: true });
  assert.match(offered, /aren't emailed/);
  assert.match(offered, /next person on your list/);
});

test("a replace that found nobody says so rather than implying cover is coming", () => {
  const nobody = withdrawDoneMessage(
    withdrawOutcome({ replacement: null, notified: true }),
    { name: "Sam", role: "Videographer", replace: true },
  );
  assert.match(nobody, /Nobody else was on the list/);
  assert.match(nobody, /emailed/);
  const someone = withdrawDoneMessage(
    withdrawOutcome({ replacement: { name: "Alex" }, notified: false }),
    { name: "Sam", role: "Videographer", replace: true },
  );
  assert.match(someone, /offered to Alex/);
});

test("the withdrawal email says they were released, not that the event is off", () => {
  const brand = {
    studioName: "GR Productions",
    productName: "StudioCue",
    accentColor: "#35664a",
    logoUrl: null,
    contactEmail: null,
  };
  const withdrawn = renderEmailTemplate({
    key: "crew_assignment_cancelled",
    brand,
    recipientName: "Sam",
    projectName: "Smith Wedding",
    values: { cause: "withdrawn", reason: "Double-booked" },
  });
  assert.match(withdrawn.subject, /Released/);
  assert.doesNotMatch(withdrawn.text, /no longer going ahead|called off/);
  assert.match(withdrawn.text, /Double-booked/);
  // The job-stopped email is unchanged.
  const stopped = renderEmailTemplate({
    key: "crew_assignment_cancelled",
    brand,
    recipientName: "Sam",
    projectName: "Smith Wedding",
    values: {},
  });
  assert.match(stopped.text, /no longer going ahead/);
});

test("the calendar file takes the day out of their diary", () => {
  const ics = assignmentIcs({
    assignmentId: "a1",
    startsAt: "2026-10-10T14:00:00.000Z",
    endsAt: "2026-10-10T23:00:00.000Z",
    projectName: "Smith Wedding",
    role: "Videographer",
    location: "The Barn",
    sequence: 2,
    stampedAt: "2026-09-30T12:00:00.000Z",
    cancelled: true,
  });
  assert.match(ics, /METHOD:CANCEL/);
  assert.match(ics, /STATUS:CANCELLED/);
  assert.match(ics, /UID:a1@studiocue/);
  assert.match(ics, /SEQUENCE:2/);
});

test("the command: owners and admins, the crew's own address, and a calendar clean-up", () => {
  const commands = read("functions/src/crew/commands.ts");
  const start = commands.indexOf('parsed.type === "withdrawAssignment"');
  assert.ok(start > 0, "no withdrawAssignment handler");
  const block = commands.slice(start, commands.indexOf('parsed.type === "setAvailability"', start));
  assert.match(block, /\["studio_owner", "studio_admin"\]\.includes\(role\)/);
  assert.match(block, /withdrawalPlan\(/);
  assert.match(block, /status: "cancelled"/);
  // Never falls through to the email worker's client-contact default.
  assert.match(block, /if \(email\) \{/);
  assert.match(block, /recipient: email/);
  assert.match(block, /cause: "withdrawn"/);
  assert.match(block, /remove_crew_calendar_invite/);
  assert.match(block, /crewCalendarEvents/);
  assert.match(block, /cascadeAssignment\(/);
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /"remove_crew_calendar_invite"\)\s*\n\s*return removeCrewCalendarInvite/);
});

test("a failed calendar removal reads as words on Today", () => {
  const { title } = describeProviderFailure("remove_crew_calendar_invite");
  assert.doesNotMatch(title, /_/);
  assert.match(title, /calendar/);
});

test("Cue can withdraw and replace, for owners and admins", () => {
  for (const id of ["withdraw_crew", "replace_crew"]) {
    const spec = STUDIO_ACTIONS.find((item) => item.id === id);
    assert.ok(spec, id);
    assert.equal(spec.ownerAdminOnly, true, id);
    assert.equal(spec.scope, "project", id);
  }
  const cards = read("components/ai/actions/prepared-actions.tsx");
  assert.match(cards, /withdraw_crew: WithdrawCrewCard/);
  assert.match(cards, /replace_crew: WithdrawCrewCard/);
});

test("the job page's crew card offers Withdraw and Replace", () => {
  const page = read("components/projects/live-project-detail.tsx");
  assert.match(page, /<WithdrawCrewControl/);
});

test("the archive refusal points at Withdraw, which now exists", () => {
  const copy = friendlyError(new Error("CREW_HAS_OPEN_ASSIGNMENT"));
  assert.match(copy, /Withdraw/);
  assert.match(ARCHIVE_REFUSALS.CREW_HAS_OPEN_ASSIGNMENT ?? "", /Withdraw/);
  assert.match(friendlyError(new Error("ASSIGNMENT_NOT_WITHDRAWABLE")), /already over/);
});

// --- 4. photo-only copy on a video offer -------------------------------------

test("a videographer's offer is a video assignment", () => {
  const offer = renderEmailTemplate({
    key: "crew_invitation",
    brand: {
      studioName: "GR Productions",
      productName: "StudioCue",
      accentColor: "#35664a",
      logoUrl: null,
      contactEmail: null,
    },
    recipientName: "Sam",
    projectName: "Smith Wedding",
    values: { role: "Videographer", inviteUrl: "https://example.com/i" },
  });
  assert.match(offer.subject, /Video assignment/);
  assert.doesNotMatch(offer.text, /photography assignment/i);
});

// --- the functions copies ---------------------------------------------------

test("the functions copy of the withdrawal rule matches features/", () => {
  const body = (path: string) => {
    const source = read(path);
    return source.slice(source.indexOf("export type WithdrawalCascade"));
  };
  assert.equal(body("functions/src/crew/withdraw.ts"), body("features/crew/withdraw.ts"));
});

test("the functions copy of crewDemand matches features/", () => {
  const body = (path: string) => {
    const source = read(path);
    return source.slice(source.indexOf("export function jobPackageSnapshotIds"));
  };
  assert.equal(
    body("functions/src/crew/staffing-plan.ts"),
    body("features/crew/staffing-plan.ts"),
  );
});

/**
 * "Gabe usually does every shoot but there may be some where he is not there
 * and he sends crew" (2026-09-30) — so whether the owner is one of the crew is
 * set per job, not assumed.
 */
test("the owner covers a role unless the job says not this time", async () => {
  const { crewDemand, ownerShootsJob, rolesToBook } = await import("@/features/crew/staffing-plan");
  const photoAndVideo = [
    { role: "photographer" as const, count: 1 },
    { role: "videographer" as const, count: 1 },
  ];
  assert.equal(ownerShootsJob({}), true);
  assert.equal(ownerShootsJob({ ownerShooting: true }), true);
  assert.equal(ownerShootsJob({ ownerShooting: false }), false);
  assert.deepEqual(rolesToBook(photoAndVideo).roles.map((role) => role.coverageRole), ["videographer"]);
  assert.deepEqual(rolesToBook(photoAndVideo, false).roles.map((role) => role.coverageRole), ["photographer", "videographer"]);
  assert.equal(rolesToBook(photoAndVideo, false).studioCovers, null);
  assert.equal(crewDemand({ coverage: photoAndVideo, assignments: [] }).crewRequired, 1);
  assert.equal(crewDemand({ coverage: photoAndVideo, assignments: [], ownerCovers: false }).crewRequired, 2);
});

test("every place that counts crew asks the job whether the owner is shooting", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "components/today/use-today-inbox.ts",
    "components/projects/use-project-journey.ts",
    "components/projects/use-readiness-evidence.ts",
    "components/crew/crew-cascade-workspace.tsx",
    "components/ai/flow-runner.tsx",
    "functions/src/workflow/commands.ts",
    "functions/src/workflow/readiness-evidence-loader.ts",
    "functions/src/crew/prepare-staffing.ts",
  ])
    assert.match(readFileSync(file, "utf8"), /ownerShootsJob\(/, file);
  const commands = readFileSync("functions/src/crew/commands.ts", "utf8");
  assert.match(commands, /type: z\.literal\("setOwnerShooting"\)/);
  assert.match(commands, /ownerShooting: parsed\.input\.ownerShooting,/);
  assert.match(readFileSync("components/projects/live-project-detail.tsx", "utf8"), /<OwnerShootingToggle ownerShooting=\{ownerShooting\} projectId=\{projectId\} \/>/);
});
