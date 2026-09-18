import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canCreateProposalForProject,
  proposalStageNotice,
  proposalStageVerdict,
} from "../features/proposals/eligibility";
import {
  journeyStepRequires,
  projectJourney,
  type JourneyInput,
} from "../features/journey/steps";

/**
 * A link into the proposal composer only exists where a proposal can be made,
 * and the composer always answers for the job it was handed.
 *
 * The composer read `?project=`, looked the id up in its list of *eligible*
 * jobs, found nothing, and returned. No message, no empty state — a picker
 * holding other people's weddings. Reached from "Add one for the record" on a
 * booked Smith wedding, the screen was then one click from sending a priced
 * offer for the Chen wedding. Three surfaces linked in from stages the command
 * refuses: the journey at LEAD, the booking autopilot past PROPOSAL, and the
 * booking workspace at CONTRACT_PENDING.
 */

test("only consultation and proposal stages can take a proposal", () => {
  assert.equal(canCreateProposalForProject("CONSULTATION"), true);
  assert.equal(canCreateProposalForProject("PROPOSAL"), true);
  for (const state of [
    "LEAD",
    "CONTRACT_PENDING",
    "RETAINER_PENDING",
    "BOOKED",
    "PLANNING",
    "READY",
    "EVENT_COMPLETE",
    "POST_PRODUCTION",
    "DELIVERED",
    "REVIEW_REQUESTED",
    "CLOSED",
    "ARCHIVED",
    "CANCELLED",
    "POSTPONED",
  ]) {
    assert.equal(
      canCreateProposalForProject(state),
      false,
      `${state} must not accept a proposal`,
    );
  }
});

test("the verdict says which way a refused job is out of range", () => {
  assert.equal(proposalStageVerdict({ state: "CONSULTATION" }), "ready");
  assert.equal(proposalStageVerdict({ state: "PROPOSAL" }), "ready");
  assert.equal(proposalStageVerdict({ state: "LEAD" }), "too_early");
  assert.equal(proposalStageVerdict({ state: "CONTRACT_PENDING" }), "past");
  assert.equal(proposalStageVerdict({ state: "BOOKED" }), "past");
  assert.equal(proposalStageVerdict({ state: "CLOSED" }), "past");
  assert.equal(proposalStageVerdict({ state: "CANCELLED" }), "not_active");
  assert.equal(proposalStageVerdict({ state: "POSTPONED" }), "not_active");
  assert.equal(proposalStageVerdict({ state: "ARCHIVED" }), "put_away");
});

/**
 * Archived wins over the stage. Rosa Ibarra's wedding was archived at
 * CONSULTATION and was still offered, first, in the composer's picker — the
 * seventh picker, built from its own query rather than the shared records, so
 * the fix that swept the other six went straight past it.
 */
test("an archived job is put away whatever stage it stopped at", () => {
  assert.equal(
    proposalStageVerdict({
      state: "CONSULTATION",
      archivedAt: "2026-09-18T00:00:00.000Z",
    }),
    "put_away",
  );
  assert.equal(
    proposalStageVerdict({ state: "PROPOSAL", archivedAt: "2026-09-18" }),
    "put_away",
  );
});

test("every refusal names the job and offers somewhere to go", () => {
  for (const verdict of ["put_away", "too_early", "past", "not_active"] as const) {
    const notice = proposalStageNotice(verdict, "Smith Wedding");
    assert.match(
      notice.heading,
      /Smith Wedding/,
      `${verdict} must name the job it is refusing`,
    );
    assert.ok(
      notice.detail.length > 30,
      `${verdict} must say what to do instead`,
    );
  }
});

/**
 * The journey never offers a step the command behind it would refuse.
 *
 * The declaration is what tests/journey-preconditions.test.ts enforces across
 * every state and record combination; this pins the single case that was wrong
 * so the reason survives with it.
 */
test("the journey needs the consultation before the proposal", () => {
  assert.deepEqual(journeyStepRequires.proposal, ["consultation"]);
});

test("the journey offers the proposal only once the consultation is behind them", () => {
  const base: JourneyInput = {
    projectId: "p1",
    state: "LEAD",
    eventDate: "2027-06-12",
    today: "2026-09-18",
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

  const leadProposal = projectJourney(base).steps.find(
    (step) => step.key === "proposal",
  );
  assert.ok(leadProposal);
  assert.equal(leadProposal.status, "upcoming");
  assert.equal(leadProposal.action, null);

  const consultingProposal = projectJourney({
    ...base,
    state: "CONSULTATION",
    hasConsultation: true,
  }).steps.find((step) => step.key === "proposal");
  assert.ok(consultingProposal);
  assert.equal(consultingProposal.status, "current");
  assert.equal(consultingProposal.action?.kind, "link");
  assert.match(
    consultingProposal.action?.kind === "link"
      ? consultingProposal.action.href
      : "",
    /\/studio\/proposals\/new\?project=p1/,
  );
});

/**
 * Source-level, because the failure is a link that simply forgot to ask. Every
 * place in the app that sends a studio to the composer with a project must
 * first check the stage — there is nothing to assert about an anchor tag.
 */
test("no surface links into the composer without checking the stage", () => {
  const callers = [
    "components/booking/booking-autopilot-workspace.tsx",
    "components/booking/project-booking-workspace.tsx",
  ];
  for (const caller of callers) {
    const source = readFileSync(`${process.cwd()}/${caller}`, "utf8");
    assert.match(
      source,
      /proposals\/new\?project=/,
      `${caller} is listed as a composer caller but no longer links there`,
    );
    assert.match(
      source,
      /canCreateProposalForProject\(/,
      `${caller} links into the proposal composer and must gate on the stage`,
    );
  }
});

/** The composer answers for the job it was handed, by id. */
test("the composer resolves the requested project itself", () => {
  const source = readFileSync(
    `${process.cwd()}/components/proposals/studio-proposal-workspace.tsx`,
    "utf8",
  );
  // Read by document id, not looked up in the capped list query — a job past
  // the first hundred is not a job that does not exist.
  assert.match(
    source,
    /getDoc\(\s*doc\(getFirebaseClient\(\)\.firestore, "projects", requested\)/,
  );
  assert.match(source, /setRefusedProject\(/);
  assert.match(source, /proposalStageNotice\(/);
  // And its picker offers live jobs only.
  assert.match(source, /proposalStageVerdict\(projectFields\(project\)\) === "ready"/);
});

/**
 * functions/ is a separate package with no "@/features" path, so the stage rule
 * is duplicated there. Keep the two copies honest.
 */
test("the functions copy of the stage rule matches features/", () => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/booking/proposal-domain.ts`,
    "utf8",
  );
  const body = source
    .slice(source.indexOf("export function canCreateProposalForProject"))
    .split("}")[0];
  assert.match(body, /state === "CONSULTATION" \|\| state === "PROPOSAL"/);
  assert.match(source, /features\/proposals\/eligibility\.ts is the source/);
});
