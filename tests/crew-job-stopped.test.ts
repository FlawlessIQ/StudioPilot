import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  archiveBlockedBy,
  dispositionFor,
  isLiveAssignment,
  LIVE_ASSIGNMENT_STATUSES,
} from "@/features/crew/job-stopped";
import { assignmentStatusSchema } from "@/features/crew/schema";
import { ARCHIVE_REFUSALS } from "@/features/records/archive";
import { projectJourney } from "@/features/journey/steps";

/**
 * What happens to the crew when a job stops.
 *
 * Nothing did: `crm/commands.ts` owns both `transitionProject` and
 * `archiveProject` and never touched `crewAssignments`, so calling off a
 * wedding left every offer standing — including an accepted one belonging to
 * somebody holding the date.
 */

// --- which statuses are still open -------------------------------------

test("every live status is a real assignment status", () => {
  for (const status of LIVE_ASSIGNMENT_STATUSES) {
    assert.equal(
      assignmentStatusSchema.safeParse(status).success,
      true,
      `${status} is not in assignmentStatusSchema`,
    );
  }
});

test("an assignment is live until it is settled", () => {
  for (const status of ["draft", "invited", "viewed", "accepted"])
    assert.equal(isLiveAssignment(status), true, status);
  for (const status of [
    "declined",
    "expired",
    "reassigned",
    "cancelled",
    "completed",
  ])
    assert.equal(isLiveAssignment(status), false, status);
});

/** Every status is either live or settled — none may fall through. */
test("the two lists cover the whole enum", () => {
  const settled = ["declined", "expired", "reassigned", "cancelled", "completed"];
  for (const status of assignmentStatusSchema.options) {
    assert.equal(
      LIVE_ASSIGNMENT_STATUSES.includes(status) || settled.includes(status),
      true,
      `${status} is in neither list`,
    );
  }
});

// --- what a cancellation does ------------------------------------------

test("an un-answered offer is withdrawn without a word", () => {
  for (const status of ["draft", "invited", "viewed"]) {
    assert.deepEqual(dispositionFor({ reason: "cancelled", status }), {
      action: "withdraw",
      notify: false,
    });
  }
});

/** The case that made the silence indefensible: they blocked the date out. */
test("somebody who accepted is withdrawn and told", () => {
  assert.deepEqual(
    dispositionFor({ reason: "cancelled", status: "accepted" }),
    { action: "withdraw", notify: true },
  );
});

test("an assignment that already ended is left alone", () => {
  for (const status of ["declined", "expired", "cancelled", "completed"]) {
    assert.equal(
      dispositionFor({ reason: "cancelled", status }).action,
      "keep",
    );
  }
});

// --- what a postponement does ------------------------------------------

test("postponing drops the offers nobody answered", () => {
  assert.deepEqual(dispositionFor({ reason: "postponed", status: "invited" }), {
    action: "withdraw",
    notify: false,
  });
});

/**
 * The date is moving, not gone. Dropping a booked crew member because a couple
 * shifted the wedding is a conversation, not a side effect — it may well be
 * the same person on the new date.
 */
test("postponing keeps a crew member who already accepted", () => {
  const disposition = dispositionFor({ reason: "postponed", status: "accepted" });
  assert.equal(disposition.action, "keep");
});

// --- archiving ----------------------------------------------------------

test("a job nobody is waiting on archives freely", () => {
  assert.equal(archiveBlockedBy([]).blocked, false);
  assert.equal(
    archiveBlockedBy([{ status: "expired" }, { status: "completed" }]).blocked,
    false,
  );
});

test("a job with a live offer refuses to be filed away", () => {
  const outcome = archiveBlockedBy([
    { status: "invited", role: "Second videographer" },
  ]);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.live, 1);
  assert.match(String(outcome.message), /second videographer/);
  // It names the move that actually ends the offer.
  assert.match(String(outcome.message), /Cancel the job/);
});

test("more than one role reads as a count, not a list", () => {
  const outcome = archiveBlockedBy([
    { status: "invited", role: "Second photographer" },
    { status: "accepted", role: "Second videographer" },
  ]);
  assert.match(String(outcome.message), /2 crew/);
});

test("the refusal has copy the studio can act on", () => {
  assert.equal(typeof ARCHIVE_REFUSALS.PROJECT_HAS_LIVE_CREW, "string");
  assert.match(
    String(ARCHIVE_REFUSALS.PROJECT_HAS_LIVE_CREW),
    /Cancel it/,
  );
});

// --- the wiring ---------------------------------------------------------

const commands = readFileSync(
  `${process.cwd()}/functions/src/crm/commands.ts`,
  "utf8",
);

test("stopping a job reaches its crew at all", () => {
  // The whole finding: this file never mentioned crewAssignments.
  assert.match(commands, /collection\("crewAssignments"\)/);
  assert.match(commands, /dispositionFor\(/);
  assert.match(commands, /archiveBlockedBy\(/);
});

/**
 * `recipientFor` in the email worker falls back to the project's first
 * *client* contact. A crew notice with no recipient would tell the couple that
 * their photographer's assignment is cancelled.
 */
test("a crew cancellation names its own recipient, never the couple's", () => {
  const block = commands.slice(
    commands.indexOf("crew_assignment_cancelled"),
    commands.indexOf("crew_assignment_cancelled") + 700,
  );
  assert.match(block, /recipient: contact\?\.email/);
  // And it is skipped outright when there is no address to use.
  const guard = commands.slice(
    commands.indexOf("if (!disposition.notify) continue;"),
    commands.indexOf("if (!disposition.notify) continue;") + 500,
  );
  assert.match(guard, /if \(!contact\) continue;/);
});

test("a cascade still working down its list is stopped too", () => {
  assert.match(commands, /crewCascades\/\$\{cascadeId\}/);
});

test("the crew-profile archive guard uses statuses that exist", () => {
  const guard = commands.length > 0;
  assert.equal(guard, true);
  const crew = readFileSync(
    `${process.cwd()}/functions/src/crew/commands.ts`,
    "utf8",
  );
  const settled = crew.slice(
    crew.indexOf("const settled = ["),
    crew.indexOf("const settled = [") + 220,
  );
  // "withdrawn" and "closed" are not assignment statuses and never were.
  assert.doesNotMatch(settled, /withdrawn|closed/);
  for (const status of ["declined", "expired", "reassigned", "cancelled", "completed"])
    assert.match(settled, new RegExp(`"${status}"`));
});

/** functions/ cannot import "@/features"; the rule is duplicated. */
test("the functions copy of the rule matches features/", () => {
  const body = (path: string) => {
    const source = readFileSync(`${process.cwd()}/${path}`, "utf8");
    return source.slice(source.indexOf("export const LIVE_ASSIGNMENT_STATUSES"));
  };
  assert.equal(
    body("functions/src/crew/job-stopped.ts"),
    body("features/crew/job-stopped.ts"),
  );
});

// --- the crew step before a package exists ------------------------------

/**
 * A brand-new enquiry read "Crew confirmed · Shooting this one solo" and
 * counted the step **done**. With no package there is no coverage and so
 * nobody to book — arithmetic, not a decision the studio has made — and the
 * journey was ticking a box on its behalf.
 */
test("a job with no package has not decided it is solo", () => {
  const base = {
    projectId: "p1",
    state: "LEAD" as const,
    eventDate: "2027-06-12",
    today: "2026-09-02",
    lead: null,
    hasConsultation: false,
    proposalStatus: null,
    contractStatus: null,
    retainerInvoiceStatus: null,
    finalInvoiceStatus: null,
    questionnaireStatus: null,
    questionnaireHasAnswers: false,
    scheduleStatus: null,
    scheduleHasUsableItems: false,
    crewAccepted: 0,
    crewRequired: 0,
    crewCascadeActive: false,
    coiStatus: null,
    insuranceRequired: "unknown",
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  };
  const crewStep = (input: Parameters<typeof projectJourney>[0]) =>
    projectJourney(input).steps.find((step) => step.key === "crew");

  const noPackage = crewStep({ ...base, packageChosen: false });
  assert.notEqual(noPackage?.status, "complete");
  assert.doesNotMatch(String(noPackage?.detail ?? ""), /solo/i);

  // A package that really does send one person still reads as solo.
  const soloPackage = crewStep({ ...base, packageChosen: true });
  assert.equal(soloPackage?.status, "complete");
  assert.match(String(soloPackage?.detail ?? ""), /solo/i);

  // And a caller with no opinion is unchanged.
  assert.equal(crewStep(base)?.status, "complete");
});
