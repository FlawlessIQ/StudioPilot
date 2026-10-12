import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { journeyProfile } from "../features/job-kinds/job-kinds";
import { clientAsks } from "../features/journey/burden";
import { LIVE_TRADES, TRADES, tradeAllows, tradeMoves, tradeProfile, tradeVocab } from "../features/trades/trades";
import { COVERAGE_ROLES, coverageRoleLabel, coverageRoleSchema } from "../features/packages/coverage";
import { crewLabels, crewTrade, labelName } from "../features/schedules/crew-labels";
import { crewLabels as serverCrewLabels } from "../functions/src/planning/crew-labels";
import { coverageRoleForLabel, coverageTradeNamed } from "../features/crew/staffing-plan";
import {
  planningChecklistApplies,
  planningScopeOf,
  scopedFormOpensOn,
  vendorTeamStarts,
} from "../features/planning/planning-scope";
import { planningFormDue } from "../functions/src/planning/planning-form-scheduler";
import { resolvePlanningTimeline } from "../functions/src/planning/planning-timeline";
import {
  consultationPurpose,
  isAppointment,
  isFinalDetailsCall,
  isSalesConsultation,
  isTrial,
  isWalkthrough,
} from "../features/consultations/purpose";
import * as serverPurpose from "../functions/src/booking/consultation-purpose";
import { currentSalesConsultation } from "../features/consultations/live";
import { trialState } from "../features/consultations/trial";
import { finalCallState } from "../features/consultations/final-call";
import { walkthroughState } from "../features/consultations/walkthrough";
import { mintBookingLink } from "../functions/src/booking/booking-link";
import { handOutLineText, handOutSummary, paymentsToHandOut } from "../features/vendors/hand-out";
import { vendorTeamProgress } from "../features/vendors/team";
import { publishedVersionOf, teamReadiness } from "../functions/src/planning/team-readiness";
import { parseVendorSection, vendorSectionLines, vendorsToImport, arrivalClock } from "../functions/src/planning/vendor-section";
import { creditLineText, creditLink, vendorCredits } from "../functions/src/planning/vendor-credits";
import { factForField, jobFactSheet, prefillFromFacts } from "../functions/src/planning/job-facts";
import { starterTemplates } from "../features/workflows/starter-templates";
import { starterTemplates as serverStarterTemplates } from "../functions/src/workflow/starter-templates";
import { checkpointSatisfiedByEvidence, noReadinessEvidence } from "../features/readiness/checkpoint-evidence";
import { checkpointSatisfiedByEvidence as serverSatisfied, noReadinessEvidence as serverNoEvidence } from "../functions/src/workflow/checkpoint-evidence";
import { setupOrderFor } from "../features/today/setup-gaps";
import { recommendedFor, recommendedQuestionnaires } from "../features/questionnaires/recommended-templates";
import { defaultInquiryFormFor } from "../features/leads/inquiry-form-config";
import { starterAgreementFor } from "../features/contracts/sample";
import { eventDetailCategory, eventDetailsFrom } from "../features/contracts/event-details";
import { examplePackagesFor } from "../features/job-kinds/example-packages";
import { extraIdeasFor } from "../features/packages/extra-ideas";
import { finalBillRaiseDaysBefore, FINAL_BILL_WINDOW_DAYS, mayRaiseFinalBill } from "../functions/src/operations/invoice-scheduler";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { budgetPrefillCents } from "../functions/src/planning/vendor-team";

/**
 * The wedding planner's trade and journey (docs/planner-journey-plan.md,
 * Phase 2: N3–N7). Photographers, DJs, makeup and hair must not move: their
 * journeys are compared, step by step, against what the code produced before
 * the planner existed (tests/fixtures/journey-before-planner.json, generated
 * from 95ae3e82).
 */

const read = (path: string) => readFileSync(path, "utf8");
const MARKER = "// ── mirrored below ──";
const below = (path: string) => read(path).slice(read(path).indexOf(MARKER));

// ─── Nobody else moves ───────────────────────────────────────────────────────

test("a photographer's, DJ's, makeup artist's and hair stylist's journeys are exactly as they were", () => {
  const before = JSON.parse(read("tests/fixtures/journey-before-planner.json")) as {
    cases: Array<{ trade: string; name: string; input: JourneyInput }>;
    outputs: unknown[];
    asks: Record<string, unknown>;
  };
  assert.equal(before.cases.length, 32);
  before.cases.forEach((item, index) => {
    assert.deepEqual(JSON.parse(JSON.stringify(projectJourney(item.input))), before.outputs[index], `${item.trade}: ${item.name}`);
  });
  for (const trade of ["photographer", "dj", "makeup", "hair"]) assert.deepEqual(clientAsks("wedding", trade), before.asks[trade], trade);
});

test("the mirrors match: planning scope, hand-out, trades", () => {
  assert.equal(below("functions/src/planning/planning-scope.ts"), below("features/planning/planning-scope.ts"));
  assert.equal(below("functions/src/planning/hand-out.ts"), below("features/vendors/hand-out.ts"));
  assert.equal(below("functions/src/trades/trades.ts"), below("features/trades/trades.ts"));
  for (const name of ["consultationPurpose", "isSalesConsultation", "isFinalDetailsCall", "isTrial", "isWalkthrough", "isAppointment"] as const) {
    for (const purpose of ["consultation", "final_details", "trial", "walkthrough", undefined, "other"]) {
      assert.equal((serverPurpose as Record<string, (row: unknown) => unknown>)[name]!({ purpose }), { consultationPurpose, isSalesConsultation, isFinalDetailsCall, isTrial, isWalkthrough, isAppointment }[name]({ purpose }), `${name}(${purpose})`);
    }
  }
  assert.deepEqual([...serverPurpose.CONSULTATION_PURPOSES], ["consultation", "final_details", "trial", "walkthrough"]);
});

// ─── N3: the trade ───────────────────────────────────────────────────────────

test("the planner is a trade, built but not live", () => {
  assert.ok(TRADES.includes("planner"));
  assert.ok(!LIVE_TRADES.includes("planner"));
  const words = tradeVocab("planner");
  assert.equal(words.provider, "planner");
  assert.equal(words.consultation, "Discovery call");
  assert.equal(words.detailsForm, "Final details");
  assert.equal(words.planOfDay, "Master timeline");
  assert.equal(words.crewStep, "Assistants confirmed");
  assert.equal(words.deposit, "retainer");
  assert.equal(words.dayName, "The wedding");
  assert.equal(words.kitChecklist?.title, "Emergency kit");
  assert.ok(words.kitChecklist?.items.some((item) => /payments and tips/.test(item)));
  assert.match(words.dayBefore?.ask ?? "", /rehearsal/);
  const shape = tradeProfile("planner");
  assert.equal(shape.family, "planning");
  assert.equal(shape.delivery, false);
  assert.equal(shape.album, false);
  assert.equal(shape.consultation, true);
  assert.equal(shape.trial, false);
  assert.equal(shape.vendorTeam, "default");
  assert.equal(shape.balanceDueDaysBefore, 30);
  assert.equal(shape.walkthroughMinutes, 60);
  assert.equal(shape.planningScope, true);
  assert.deepEqual(shape.plans, ["vendor"]);
  assert.deepEqual(shape.coverageRoles, ["coordinator"]);
  assert.deepEqual(shape.planning, { formAtBooking: false, lockDaysBefore: 14, formMonthsBefore: 3, formSend: "auto", finalCall: false });
  assert.equal(shape.journey.callRequired, true);
  assert.equal(shape.journey.oneLinkBooking, true);
  assert.equal(shape.journey.vendorSteps, true);
  assert.equal(shape.journey.walkthrough, true);
  assert.equal(shape.journey.readiness, "planner");
  for (const trade of ["photographer", "dj", "makeup", "hair"]) {
    assert.equal(tradeProfile(trade).journey.vendorSteps, false, trade);
    assert.equal(tradeProfile(trade).journey.walkthrough, false, trade);
    assert.equal(tradeProfile(trade).planningScope, false, trade);
    assert.equal(tradeProfile(trade).walkthroughMinutes, null, trade);
  }
});

test("nothing is delivered: the day leads to the review", () => {
  assert.equal(tradeAllows("planner", "POST_PRODUCTION"), false);
  assert.equal(tradeAllows("planner", "DELIVERED"), false);
  assert.equal(tradeAllows("planner", "REVIEW_REQUESTED"), true);
  assert.deepEqual([...tradeMoves("planner", "EVENT_COMPLETE")], ["REVIEW_REQUESTED", "CLOSED"]);
});

test("assistant coordinators are their own crew track: C1, C2", () => {
  assert.ok(COVERAGE_ROLES.includes("coordinator"));
  assert.ok(coverageRoleSchema.safeParse("coordinator").success);
  assert.equal(coverageRoleLabel("coordinator", 2), "coordinators");
  assert.equal(crewTrade("Assistant coordinator"), "coordinator");
  assert.equal(crewTrade("Lead planner"), "coordinator");
  // A photographer's assistant is still a photographer's.
  assert.equal(crewTrade("Photo assistant"), "photographer");
  assert.equal(crewTrade("Second shooter"), "photographer");
  assert.equal(coverageRoleForLabel("Day-of coordinator"), "coordinator");
  // "Planner" alone is a vendor on the wedding, not a crew trade Cue staffs.
  assert.equal(coverageTradeNamed("planner"), null);
  assert.equal(coverageTradeNamed("assistant coordinator"), "coordinator");
  const members = [
    { id: "a", role: "Assistant coordinator", order: 2 },
    { id: "b", role: "Lead coordinator", order: 1 },
    { id: "p", role: "Lead photographer", order: 1 },
  ];
  const labels = crewLabels(members);
  assert.equal(labels.get("b")?.label, "C1");
  assert.equal(labels.get("a")?.label, "C2");
  assert.equal(labels.get("p")?.label, "P1");
  assert.deepEqual([...serverCrewLabels(members)], [...labels]);
  assert.equal(labelName("C2"), "Coordinator 2");
  assert.match(read("cloud-run/pdf/run_of_show.py"), /\("C", 1\): \("#[0-9A-F]{6}", "#[0-9A-F]{6}"\)/);
  assert.match(read("cloud-run/pdf/run_of_show.py"), /\("C", 2\): \("#[0-9A-F]{6}", "#[0-9A-F]{6}"\)/);
});

// ─── N4: the tier ────────────────────────────────────────────────────────────

test("a month-of couple's final details go out eight weeks before; full and partial keep the timeline", () => {
  const coordination = { planningScope: "coordination" };
  assert.equal(planningScopeOf(coordination), "coordination");
  assert.equal(planningScopeOf({ planningScope: "everything" }), null);
  assert.equal(planningScopeOf(null), null);
  assert.equal(scopedFormOpensOn(coordination, "2027-06-12", "2027-03-12"), "2027-04-17");
  assert.equal(scopedFormOpensOn({ planningScope: "full" }, "2027-06-12", "2027-03-12"), "2027-03-12");
  assert.equal(scopedFormOpensOn({}, "2027-06-12", "2027-03-12"), "2027-03-12");
  assert.equal(vendorTeamStarts(coordination), "intake");
  assert.equal(vendorTeamStarts({ planningScope: "partial" }), "booking");
  assert.equal(vendorTeamStarts({}), "booking");
  // Phase 3's hook, read by nothing yet.
  assert.equal(planningChecklistApplies({ planningScope: "full" }), true);
  assert.equal(planningChecklistApplies({ planningScope: "partial" }), true);
  assert.equal(planningChecklistApplies(coordination), false);
  // The scheduler: a planner studio's timeline sends three months out.
  const timeline = resolvePlanningTimeline({ ...tradeProfile("planner").planning });
  const wedding = (scope: string | null) => ({ state: "BOOKED", eventDate: "2027-06-12", eventKind: "wedding", ...(scope ? { planningScope: scope } : {}) });
  assert.equal(planningFormDue(wedding("full"), timeline, "2027-03-12"), true);
  assert.equal(planningFormDue(wedding("coordination"), timeline, "2027-03-12"), false);
  assert.equal(planningFormDue(wedding("coordination"), timeline, "2027-04-16"), false);
  assert.equal(planningFormDue(wedding("coordination"), timeline, "2027-04-17"), true);
  // Every other studio's job, with no tier, is unchanged.
  const photographer = resolvePlanningTimeline({ formSend: "auto" });
  assert.equal(planningFormDue(wedding(null), photographer, "2026-12-12"), true);
  assert.equal(planningFormDue(wedding(null), photographer, "2026-12-11"), false);
});

test("the tier rides on the package, its snapshot and the job", () => {
  const commands = read("functions/src/crm/commands.ts");
  assert.match(commands, /planningScope: z\.enum\(PLANNING_SCOPES\)\.nullable\(\)\.optional\(\)/);
  assert.match(commands, /\.\.\.\(isPlanningScope\(packageDocument\.get\("planningScope"\)\)\s*\? \{ planningScope: packageDocument\.get\("planningScope"\) \}/);
  assert.match(commands, /planningScope: isPlanningScope\(packageDocument\.get\("planningScope"\)\)\s*\? packageDocument\.get\("planningScope"\)\s*: null,/);
  const examples = examplePackagesFor("planner", "wedding");
  assert.deepEqual(examples.map((example) => [example.name, example.planningScope]), [
    ["Full planning", "full"],
    ["Partial planning", "partial"],
    ["Month-of coordination", "coordination"],
  ]);
  for (const example of examples) assert.match(example.typicalPrice ?? "", /^\$[\d,]+–\$[\d,]+$/, example.name);
  // Nobody else's examples change.
  assert.ok(examplePackagesFor("photographer", "wedding").every((example) => example.planningScope === undefined));
  assert.deepEqual(
    extraIdeasFor("planner").map((idea) => [idea.name, idea.perUnit]),
    [
      ["Additional assistant", "person"],
      ["Extra hour", "hour"],
      ["Rehearsal dinner", null],
      ["Welcome party", null],
      ["Farewell brunch", null],
      ["Travel", null],
    ],
  );
});

// ─── The journey ─────────────────────────────────────────────────────────────

const team = (overrides: Partial<ReturnType<typeof vendorTeamProgress>> = {}) => ({
  ...vendorTeamProgress([], [], null),
  ...overrides,
});

function plannerInput(overrides: Partial<JourneyInput> = {}): JourneyInput {
  return {
    projectId: "p1",
    state: "LEAD",
    eventDate: "2027-06-12",
    today: "2026-10-12",
    lead: { id: "l1", status: "new" },
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
    profile: journeyProfile("wedding"),
    trade: "planner",
    // The planner's timeline has the final call off: the hook passes none.
    finalCall: null,
    vendorTeam: null,
    walkthrough: { state: "not_booked", startsAt: null },
    ...overrides,
  };
}

const booked: Partial<JourneyInput> = {
  state: "BOOKED",
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  lead: { id: "l1", status: "converted", replied: true },
};

const keys = (input: JourneyInput) => projectJourney(input).steps.map((step) => step.key);
const step = (input: JourneyInput, key: string) => projectJourney(input).steps.find((candidate) => candidate.key === key)!;

test("a planner's wedding: eleven steps, the vendor team and the walkthrough among them", () => {
  assert.deepEqual(keys(plannerInput()), [
    "inquiry",
    "consultation",
    "proposal",
    "contract",
    "vendor_team",
    "schedule_form",
    "walkthrough",
    "vendors_confirmed",
    "final_balance",
    "event_day",
    "album_review",
  ]);
  const journey = projectJourney(plannerInput());
  assert.deepEqual(
    journey.steps.map((candidate) => candidate.title),
    ["Inquiry", "Discovery call", "Proposal", "Booked", "Vendor team", "Final details", "Venue walkthrough", "Vendors confirmed", "Final balance", "The wedding", "Review"],
  );
  // The discovery call is required, as a photographer's consultation is.
  assert.equal(journey.current?.key, "inquiry");
  assert.equal(step(plannerInput({ lead: { id: "l1", status: "converted", replied: true } }), "consultation").status, "current");
  assert.equal(step(plannerInput({ lead: { id: "l1", status: "converted", replied: true } }), "proposal").status, "upcoming");
  // A venue that asks for insurance, and assistants offered, bring their steps back.
  const both = keys(plannerInput({ ...booked, insuranceRequired: "required", crewRequired: 1 }));
  assert.ok(both.includes("coi") && both.includes("crew"));
  assert.ok(both.length <= 13);
});

test("full and partial planning work the vendor team from booking; month-of from the intake", () => {
  const full = plannerInput({ ...booked, vendorTeamStarts: "booking" });
  assert.equal(projectJourney(full).current?.key, "vendor_team");
  assert.equal(step(full, "vendor_team").detail, "Add the vendors this wedding needs");
  assert.deepEqual(step(full, "vendor_team").action, { kind: "link", label: "Open the vendor team", href: "/studio/projects/p1#vendor-team" });
  const progressing = plannerInput({ ...booked, vendorTeam: team({ total: 5, booked: 3, needed: 2 }) });
  assert.equal(step(progressing, "vendor_team").detail, "3 of 5 booked · 2 still to find");
  const complete = plannerInput({ ...booked, vendorTeam: team({ total: 4, booked: 4, teamComplete: true }) });
  assert.equal(step(complete, "vendor_team").status, "complete");
  assert.equal(step(complete, "vendor_team").detail, "All 4 vendors booked");

  const monthOf = plannerInput({ ...booked, vendorTeamStarts: "intake" });
  assert.equal(step(monthOf, "vendor_team").status, "upcoming");
  assert.equal(step(monthOf, "vendor_team").action, null);
  assert.match(step(monthOf, "vendor_team").detail, /eight weeks out/);
  assert.equal(step(monthOf, "vendor_team").unlock, "Their vendors come in with their final details, eight weeks out.");
  const formOut = plannerInput({ ...booked, vendorTeamStarts: "intake", questionnaireStatus: "in_progress", today: "2027-04-20" });
  assert.equal(step(formOut, "vendor_team").status, "waiting_client");
  // Once their vendors are on the team, it is the studio's to finish.
  const intakeIn = plannerInput({ ...booked, vendorTeamStarts: "intake", questionnaireStatus: "submitted", questionnaireHasAnswers: true, vendorTeam: team({ total: 4, booked: 3, needed: 1 }), today: "2027-05-01" });
  assert.equal(step(intakeIn, "vendor_team").status, "current");
  // Before booking, nobody is asked.
  assert.equal(step(plannerInput(), "vendor_team").status, "upcoming");
});

test("the venue walkthrough opens six weeks out, and is the couple's to book", () => {
  const early = plannerInput({ ...booked, today: "2027-04-20" });
  assert.equal(step(early, "walkthrough").status, "upcoming");
  const window = plannerInput({ ...booked, state: "PLANNING", vendorTeam: team({ total: 2, booked: 2, teamComplete: true }), questionnaireStatus: "submitted", questionnaireHasAnswers: true, today: "2027-05-01" });
  assert.equal(projectJourney(window).current?.key, "walkthrough");
  assert.deepEqual(step(window, "walkthrough").action, { kind: "link", label: "Invite them to book it", href: "/studio/projects/p1#walkthrough" });
  const invited = plannerInput({ ...booked, today: "2027-05-01", walkthrough: { state: "invited", startsAt: null } });
  assert.equal(step(invited, "walkthrough").status, "waiting_client");
  const bookedWalk = plannerInput({ ...booked, today: "2027-05-01", walkthrough: { state: "booked", startsAt: "2027-05-08T15:00:00.000Z", when: "Sat, May 8 at 11:00 AM" } });
  assert.equal(step(bookedWalk, "walkthrough").status, "waiting_other");
  assert.equal(step(bookedWalk, "walkthrough").detail, "Booked for Sat, May 8 at 11:00 AM");
  const held = plannerInput({ ...booked, today: "2027-05-20", walkthrough: { state: "held", startsAt: "2027-05-08T15:00:00.000Z", when: "May 8" } });
  assert.equal(step(held, "walkthrough").status, "complete");
});

test("vendors confirmed: the master timeline first, then the send, then '7 of 9 confirmed'", () => {
  const settled = { ...booked, state: "PLANNING", questionnaireStatus: "submitted", questionnaireHasAnswers: true, walkthrough: { state: "held" as const, startsAt: "2027-05-08T15:00:00.000Z" }, today: "2027-05-10" };
  const noTimeline = plannerInput({ ...settled, vendorTeam: team({ total: 9, booked: 9, teamComplete: true, timeline: { sent: 0, confirmed: 0, older: 0, notSent: 9 } }) });
  const unpublished = step(noTimeline, "vendors_confirmed");
  assert.equal(projectJourney(noTimeline).current?.key, "vendors_confirmed");
  assert.match(unpublished.detail, /^Master timeline first — /);
  assert.equal(unpublished.action?.kind === "link" && unpublished.action.href, "/studio/schedules/new?project=p1");
  assert.ok(!keys(noTimeline).includes("run_of_show"));
  const published = { scheduleStatus: "published", scheduleHasUsableItems: true };
  const toSend = plannerInput({ ...settled, ...published, vendorTeam: team({ total: 9, booked: 9, teamComplete: true, timeline: { sent: 7, confirmed: 7, older: 0, notSent: 2 } }) });
  assert.equal(step(toSend, "vendors_confirmed").detail, "7 of 9 confirmed · 2 to send");
  assert.deepEqual(step(toSend, "vendors_confirmed").action, { kind: "link", label: "Send the timeline", href: "/studio/projects/p1#vendor-team" });
  const waiting = plannerInput({ ...settled, ...published, vendorTeam: team({ total: 9, booked: 9, teamComplete: true, timeline: { sent: 9, confirmed: 7, older: 0, notSent: 0 } }) });
  assert.equal(step(waiting, "vendors_confirmed").status, "waiting_other");
  assert.equal(step(waiting, "vendors_confirmed").detail, "7 of 9 confirmed · waiting on 2");
  const all = plannerInput({ ...settled, ...published, vendorTeam: team({ total: 9, booked: 9, teamComplete: true, allConfirmed: true, timeline: { sent: 9, confirmed: 9, older: 0, notSent: 0 } }) });
  assert.equal(step(all, "vendors_confirmed").status, "complete");
  assert.equal(step(all, "vendors_confirmed").detail, "All 9 confirmed on the current timeline");
});

test("the day before: the rehearsal, the emergency kit and the envelopes; the day opens the contact sheet", () => {
  const dayBefore = plannerInput({
    ...booked,
    state: "READY",
    today: "2027-06-11",
    questionnaireStatus: "submitted",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleHasUsableItems: true,
    finalInvoiceStatus: "paid",
    dayBeforeDraftStatus: "approved",
    vendorTeam: team({ total: 3, booked: 3, teamComplete: true, allConfirmed: true }),
    walkthrough: { state: "held", startsAt: "2027-05-08T15:00:00.000Z" },
    handOut: "3 envelopes to hand out, $1,550",
  });
  const day = step(dayBefore, "event_day");
  assert.equal(day.title, "The wedding");
  assert.equal(day.detail, "Pack the emergency kit · 3 envelopes to hand out, $1,550");
  assert.deepEqual(day.record, { label: "Vendor contact sheet", href: "/studio/projects/p1/vendors/print" });
  // Not yet sent, the rehearsal note is the move, with the envelopes beside it.
  const draft = plannerInput({ ...booked, state: "READY", today: "2027-06-11", dayBeforeDraftStatus: null, handOut: "1 envelope to hand out, $100" });
  assert.equal(step(draft, "event_day").detail, "The rehearsal, the license and rings, the tip envelopes · 1 envelope to hand out, $100");
  // After the day: the review, nothing delivered.
  const after = plannerInput({ ...booked, state: "EVENT_COMPLETE", today: "2027-06-14" });
  assert.ok(!keys(after).includes("delivery"));
  assert.equal(projectJourney(after).current?.key, "album_review");
});

// ─── The burden ──────────────────────────────────────────────────────────────

test("the planner's burden: six asks, five checks, five setup questions", () => {
  assert.deepEqual(
    clientAsks("wedding", "planner").map((ask) => ask.key),
    ["call", "accept_sign", "deposit", "form", "walkthrough", "balance"],
  );
  const checks = starterTemplates("planner").find((template) => template.eventTypeId === "wedding")!.checkpointTemplates;
  assert.deepEqual(
    checks.map((check) => check.key),
    ["vendor-team-complete", "final-balance", "questionnaire-complete", "vendors-confirmed", "contract-completed"].sort(
      (left, right) => checks.findIndex((check) => check.key === left) - checks.findIndex((check) => check.key === right),
    ),
  );
  assert.equal(checks.length, 5);
  assert.deepEqual(new Set(checks.map((check) => check.key)), new Set(["contract-completed", "vendor-team-complete", "questionnaire-complete", "vendors-confirmed", "final-balance"]));
  assert.deepEqual(starterTemplates("planner", { balanceDueDaysBefore: 30 }), serverStarterTemplates("planner", { balanceDueDaysBefore: 30 }));
  assert.equal(
    starterTemplates("planner", { balanceDueDaysBefore: 30 }).find((template) => template.eventTypeId === "wedding")!.checkpointTemplates.find((check) => check.key === "final-balance")!.dueDateRule.offsetDays,
    -30,
  );
  assert.deepEqual([...setupOrderFor("planner")], ["packages", "availability", "inquiries", "agreement", "insurance"]);
  assert.match(read("functions/src/saas/onboarding.ts"), /trade\.journey\.readiness !== "full"\s*\? starterTemplates\(trade\.journey\.readiness, \{/);
});

test("the two vendor-team checks are read from the records, the same on both sides", () => {
  const entry = (vendorId: string, status = "booked") => ({ vendorId, status });
  const share = (vendorId: string, status: string, sharedVersion: number) => ({ vendorContactId: vendorId, status, sharedVersion });
  const fixtures: Array<[Array<Record<string, unknown>>, Array<Record<string, unknown>>, number | null]> = [
    [[], [], null],
    [[entry("a"), entry("b")], [share("a", "acknowledged", 3), share("b", "acknowledged", 3)], 3],
    [[entry("a"), entry("b")], [share("a", "acknowledged", 3), share("b", "acknowledged", 2)], 3],
    [[entry("a"), entry("", "needed")], [share("a", "acknowledged", 3)], 3],
    [[entry("a"), entry("b", "declined")], [share("a", "viewed", 3)], 3],
    [[entry("a")], [{ ...share("a", "acknowledged", 3), revokedAt: "2027-01-01" }], 3],
  ];
  for (const [entries, shares, version] of fixtures) {
    const progress = vendorTeamProgress(entries, shares, version);
    assert.deepEqual(teamReadiness(entries, shares, version), { vendorTeamComplete: progress.teamComplete, vendorsConfirmed: progress.allConfirmed });
  }
  assert.equal(publishedVersionOf([{ version: 2, status: "published" }, { version: 3, status: "draft" }]), null);
  assert.equal(publishedVersionOf([{ version: 2, status: "superseded" }, { version: 3, status: "published" }]), 3);
  const check = (key: string) => ({ completionMethod: "system_rule", templateKey: key });
  for (const [satisfied, none] of [[checkpointSatisfiedByEvidence, noReadinessEvidence], [serverSatisfied, serverNoEvidence]] as const) {
    assert.equal(satisfied(check("vendor-team-complete"), none), false);
    assert.equal(satisfied(check("vendor-team-complete"), { ...none, vendorTeamComplete: true }), true);
    assert.equal(satisfied(check("vendors-confirmed"), { ...none, vendorsConfirmed: true }), true);
    // The certificate check is read as before.
    assert.equal(satisfied(check("coi-approved"), { ...none, vendorsConfirmed: true }), false);
  }
  const triggers = read("functions/src/workflow/readiness-triggers.ts");
  assert.match(triggers, /readinessOnProjectVendorWritten = readinessTriggerFor\("projectVendors"\)/);
  assert.match(triggers, /readinessOnScheduleShareWritten = readinessTriggerFor\("scheduleShares"\)/);
});

// ─── N5: the walkthrough is never a sales call ───────────────────────────────

test("a walkthrough is never the sales call, the final call or the trial", () => {
  const walk = { id: "w", projectId: "p1", purpose: "walkthrough", status: "scheduled", startsAt: "2027-05-08T15:00:00.000Z" };
  assert.equal(consultationPurpose(walk), "walkthrough");
  assert.equal(isSalesConsultation(walk), false);
  assert.equal(isFinalDetailsCall(walk), false);
  assert.equal(isTrial(walk), false);
  assert.equal(isWalkthrough(walk), true);
  assert.equal(isAppointment(walk), true);
  assert.equal(isAppointment({ purpose: "trial" }), true);
  assert.equal(isAppointment({ purpose: "consultation" }), false);
  assert.equal(currentSalesConsultation([walk]), null);
  assert.deepEqual(trialState({ consultations: [walk], now: "2027-05-01T00:00:00Z" }), { state: "not_booked", startsAt: null });
  const project = { eventDate: "2027-06-12", eventKind: "wedding" };
  assert.equal(finalCallState({ project, planningTimeline: {}, consultations: [walk], today: "2027-05-20", now: "2027-05-20T00:00:00Z" })?.state, "invited");
  assert.deepEqual(walkthroughState({ consultations: [walk], project, now: "2027-05-01T00:00:00Z" }), { state: "booked", startsAt: walk.startsAt });
  assert.deepEqual(walkthroughState({ consultations: [walk], project, now: "2027-05-09T00:00:00Z" }), { state: "held", startsAt: walk.startsAt });
  assert.deepEqual(
    walkthroughState({ consultations: [], project: { ...project, walkthroughInvitedAt: "2027-04-30T00:00:00Z", walkthroughInviteExpiresAt: "2027-06-11T00:00:00Z" }, now: "2027-05-01T00:00:00Z" }),
    { state: "invited", startsAt: null },
  );
  assert.deepEqual(walkthroughState({ consultations: [{ ...walk, status: "cancelled" }], project, now: "2027-05-01T00:00:00Z" }), { state: "not_booked", startsAt: null });
  const link = mintBookingLink({ tenantId: "t", projectId: "p", contactId: "c", email: "a@b.co", mode: "in_person", purpose: "walkthrough", actorId: "u", now: "2027-04-30T00:00:00.000Z", days: 30 });
  assert.match(link.linkId, /^walk_/);
  assert.equal(link.record.purpose, "walkthrough");
  // The server: the walkthrough's own length, its own window, the job's own record.
  const server = read("functions/src/booking/public-scheduling.ts");
  assert.match(server, /purpose: z\.enum\(CONSULTATION_PURPOSES\)\.default\("consultation"\)/);
  assert.match(server, /walkthroughInvitedAt: now, walkthroughInviteExpiresAt: expiresAt/);
  assert.match(server, /walkthroughBookedAt: now/);
  // Only the sales call moves a job on.
  assert.match(server, /const salesCall = isSalesConsultation\(link\.data\(\)\);/);
});

test("the walkthrough invitation says what it is", () => {
  const brand = { studioName: "Wren & Co. Events", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const email = renderEmailTemplate({ key: "consultation_invitation", brand, recipientName: "Maya Brooks", projectName: "Maya Brooks Wedding", values: { purpose: "walkthrough", trade: "planner", actionUrl: "https://studio-cue.com/schedule/consultation?token=x" } });
  assert.equal(email.subject, "Book your venue walkthrough with Wren & Co. Events");
  assert.match(email.text, /walk the venue with us/);
  assert.match(email.text, /https:\/\/studio-cue\.com\/schedule\/consultation\?token=x/);
});

// ─── N6: starter content ─────────────────────────────────────────────────────

test("the Final details form: the vendor section, prefilled from the team and read back into it", () => {
  const form = recommendedQuestionnaires().find((candidate) => candidate.id === "planner-final-details")!;
  assert.equal(form.dueDaysBeforeEvent, 28);
  assert.deepEqual(form.trades, ["planner"]);
  const fields = form.sections.flatMap((section) => section.fields);
  for (const id of ["getting-ready", "ceremony-time", "reception-time", "processional", "key-people", "decor-bringing", "venue-rules", "rehearsal-date-time", "rehearsal-attendees", "guest-count", "vendor-team"])
    assert.ok(fields.some((field) => field.id === id), id);
  assert.equal(fields.find((field) => field.id === "vendor-team")?.type, "repeating_group");
  // A planner starts with it alone: no event details form at the inquiry.
  assert.deepEqual(recommendedFor("planner").map((candidate) => candidate.id), ["planner-final-details"]);
  // Nobody else gets it.
  for (const trade of ["photographer", "dj", "makeup", "hair"]) assert.ok(!recommendedFor(trade).some((candidate) => candidate.id === "planner-final-details"), trade);

  // The prefill: the team, one per line.
  const entries = [
    { id: "p_1", data: { category: "florist", status: "booked", company: "Petal & Stem", contactName: "Rosa Diaz", phone: "908 555 0117", email: "rosa@petalandstem.example", arrivalTime: "13:30", createdAt: "1" } },
    { id: "p_2", data: { category: "bakery", status: "needed", company: null, createdAt: "2" } },
    { id: "p_3", data: { category: "dj", roleLabel: "Dinner and dancing", status: "considering", company: "Spin Theory DJs", createdAt: "3" } },
  ];
  assert.equal(
    vendorSectionLines(entries.map((entry) => entry.data)),
    "Florist — Petal & Stem — Rosa Diaz, 908 555 0117, rosa@petalandstem.example — arriving 1:30 PM\nDJ (Dinner and dancing) — Spin Theory DJs",
  );
  const field = fields.find((candidate) => candidate.id === "vendor-team")!;
  assert.equal(factForField(field, "planner"), "vendor_team");
  // A photographer's form never asks it: the fact is read by the field's id alone.
  assert.equal(factForField({ ...field, id: "vendors" }, "planner"), null);
  const sheet = jobFactSheet({ projectId: "p1", project: { state: "BOOKED" }, leadId: null, lead: null, contacts: [], vendors: [], schedule: null, responses: [], team: entries });
  const prefill = prefillFromFacts({ sheet, sections: form.sections, trade: "planner" });
  assert.equal(prefill.answers["vendor-team"], vendorSectionLines(entries.map((entry) => entry.data)));
  assert.equal((prefill.answerProvenance["vendor-team"] as { fact?: string }).fact, "vendor_team");

  // What the couple writes back.
  const written = [
    "Florist — Petal & Stem — Rosa Diaz, 908 555 0117, rosa@petalandstem.example — arriving 1:30 PM",
    "Photographer: Hart Light Studio, hello@hartlight.example, 201 555 0199, arriving 12:00 PM",
    "- Cake — Sugar Bloom Bakery — Ana",
    "Officiant; Rev. Jo Park; (973) 555-0142",
    "Band | The Tuesday Club | load-in 5pm",
    "Hair and makeup — TBD",
    "Transportation:",
    "",
  ].join("\n");
  const parsed = parseVendorSection(written);
  assert.deepEqual(
    parsed.map((vendor) => [vendor.category, vendor.company, vendor.contactName, vendor.email, vendor.phone, vendor.arrivalTime]),
    [
      ["florist", "Petal & Stem", "Rosa Diaz", "rosa@petalandstem.example", "908 555 0117", "13:30"],
      ["photographer", "Hart Light Studio", "", "hello@hartlight.example", "201 555 0199", "12:00"],
      ["bakery", "Sugar Bloom Bakery", "Ana", null, null, null],
      ["officiant", "Rev. Jo Park", "", null, "(973) 555-0142", null],
      ["band", "The Tuesday Club", "", null, null, "17:00"],
    ],
  );
  // Only who the team doesn't have: Petal & Stem is already on it.
  assert.deepEqual(
    vendorsToImport(parsed, entries.map((entry) => entry.data)).map((vendor) => vendor.company),
    ["Hart Light Studio", "Sugar Bloom Bakery", "Rev. Jo Park", "The Tuesday Club"],
  );
  // Sent back unchanged, it adds nobody.
  assert.deepEqual(vendorsToImport(parseVendorSection(prefill.answers["vendor-team"]), entries.map((entry) => entry.data)), []);
  assert.equal(arrivalClock("noon"), "12:00");
  assert.equal(arrivalClock("7"), null);
  assert.deepEqual(parseVendorSection(null), []);
  // The couple's save runs the import, and never fails it.
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /await importVendorsFromForm\(db, \{/);
  assert.match(commands, /vendor_team\.form_import_failed/);
});

test("the planner's inquiry form asks what she prices on, and the wedding's budget", () => {
  const form = defaultInquiryFormFor("planner");
  assert.equal(form.askBudget, true);
  assert.deepEqual(form.questions.map((question) => question.id), ["venue-booked", "planning-tier", "vendors-booked"]);
  const wedding = form.eventTypes.find((type) => type.id === "wedding")!;
  assert.equal(wedding.venue, true);
  assert.equal(wedding.guests, true);
  assert.equal(wedding.coi, false);
  // Everyone else's is as it was: no budget question by default.
  for (const trade of ["photographer", "dj", "makeup", "hair"]) assert.equal(defaultInquiryFormFor(trade).askBudget, false, trade);
  // The budget asked is the whole wedding's, so the job's light budget starts from it.
  assert.equal(budgetPrefillCents("planner", "About $50,000"), 5_000_000);
  assert.match(read("functions/src/intake/convert.ts"), /budgetPrefillCents\(tenant\.get\("trade"\), lead\.get\("budgetRange"\)\)/);
  assert.match(read("components/crm/lead-intake-form.tsx"), /value: "About \$35,000"/);
});

test("the planner's starter agreement and Schedule A", () => {
  const { title, body } = starterAgreementFor("planner");
  assert.equal(title, "Wedding Planning Agreement");
  for (const clause of [
    /contracts with and pays every vendor directly/,
    /not responsible for any vendor's performance/,
    /shares each vendor's contract/,
    /no referral fees or commissions/,
    /more than six hours/,
    /overtime rate/,
    /Travel beyond/,
    /tuxedos/,
    /A retainer of \{\{price\.retainer\}\} reserves the date/,
    /\{\{package\.deliverables\}\}/,
  ])
    assert.match(body, clause);
  // Schedule A: the rehearsal is a planner's part; a photographer's reads as before.
  assert.equal(eventDetailCategory("Rehearsal day and time", "planner"), "rehearsal");
  assert.equal(eventDetailCategory("Rehearsal day and time", "photographer"), "times");
  assert.equal(eventDetailCategory("Key people and their cell numbers", "planner"), "contacts");
  assert.equal(eventDetailCategory("Key people and their cell numbers"), null);
  const details = eventDetailsFrom({
    eventType: "Wedding",
    eventKind: "wedding",
    date: "June 12, 2027",
    venue: "Hollow Oak Inn",
    coverage: "2 coordinators, 10 hours",
    answers: [
      { question: "Rehearsal day and time", answer: "Friday at 5 PM" },
      { question: "Final guest count", answer: "140" },
    ],
    lockDaysBefore: 14,
    trade: "planner",
  });
  assert.deepEqual(details.missing, ["Reception"]);
  assert.ok(details.rows.some((row) => row.label === "Rehearsal" && row.value === "Friday at 5 PM"));
  assert.ok(details.rows.some((row) => row.label === "Service"));
});

// ─── N7: the day and after ───────────────────────────────────────────────────

test("payments and tips to hand out come from the vendor team", () => {
  const handOut = paymentsToHandOut(
    [
      { status: "booked", company: "Petal & Stem", category: "florist", balanceDueCents: 120_000, balanceDueDate: "2027-06-12", tipCents: 10_000 },
      { status: "booked", company: "Spin Theory DJs", category: "dj", balanceDueCents: 85_000, balanceDueDate: "2027-05-29", tipCents: 15_000 },
      { status: "booked", company: "Hollow Oak Inn", category: "venue", balanceDueCents: 0, tipCents: null },
      { status: "booked", company: "Sugar Bloom", category: "bakery", balanceDueCents: 30_000, balanceDueDate: null, tipCents: null },
      { status: "considering", company: "Maybe Band", category: "band", balanceDueCents: 500_000, tipCents: 10_000 },
      { status: "booked", company: "Gone Co", category: "rentals", balanceDueCents: 1_000, tipCents: null, archivedAt: "2027-01-01" },
    ],
    "2027-06-12",
  );
  assert.deepEqual(handOut.lines.map(handOutLineText), [
    "Petal & Stem (Florist): balance $1,200 and tip $100",
    // Its balance was due two weeks before: paid ahead, so only the tip.
    "Spin Theory DJs (DJ): tip $150",
    "Sugar Bloom (Cake): balance $300",
  ]);
  assert.equal(handOut.totalCents, 175_000);
  assert.equal(handOutSummary(handOut), "3 envelopes to hand out, $1,750");
  assert.equal(handOutSummary(paymentsToHandOut([], "2027-06-12")), null);
  // In the assistants' reminder, a planner's only.
  const brand = { studioName: "Wren & Co. Events", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const reminder = renderEmailTemplate({ key: "crew_reminder", brand, recipientName: "Jo", projectName: "Maya Brooks Wedding", values: { trade: "planner", handOut: handOut.lines.map(handOutLineText), scheduleUrl: "https://studio-cue.com/crew/schedule?assignment=a" } });
  assert.match(reminder.text, /Payments and tips to hand out — Petal & Stem \(Florist\): balance \$1,200 and tip \$100; /);
  assert.match(reminder.text, /Emergency kit — before you leave, check/);
  const photographer = renderEmailTemplate({ key: "crew_reminder", brand, recipientName: "Jo", projectName: "Maya Brooks Wedding", values: { scheduleUrl: "https://studio-cue.com/crew/schedule?assignment=a" } });
  assert.doesNotMatch(photographer.text, /Payments and tips/);
  assert.match(read("functions/src/communications/event-reminders.ts"), /if \(!tradeProfile\(await tenantTrade\(db, tenantId\)\)\.journey\.vendorSteps\) return \[\];/);
});

test("vendor credits: the studio first, then every booked vendor, once", () => {
  const credits = vendorCredits({
    entries: [
      { vendorId: "v_dj", status: "booked", category: "dj", company: "Spin Theory DJs" },
      { vendorId: "v_fl", status: "booked", category: "florist", company: "Petal & Stem" },
      { vendorId: "v_venue", status: "booked", category: "venue", company: "Hollow Oak Inn" },
      { vendorId: "v_cake", status: "needed", category: "bakery", company: null },
      { vendorId: "v_photo", status: "declined", category: "photographer", company: "Nope Studio" },
    ],
    vendors: new Map([
      ["v_fl", { website: "https://www.petalandstem.com/", company: "Petal & Stem" }],
      ["v_dj", { website: "https://instagram.com/spintheorydjs", company: "Spin Theory DJs" }],
    ]),
    studio: { name: "Wren & Co. Events", website: "wrenandco.example", category: "Planning" },
  });
  assert.deepEqual(credits.map(creditLineText), [
    "Planning: Wren & Co. Events (wrenandco.example)",
    "Venue: Hollow Oak Inn",
    "Florals: Petal & Stem (petalandstem.com)",
    "DJ: Spin Theory DJs (@spintheorydjs)",
  ]);
  assert.equal(creditLink("@petals"), "@petals");
  assert.equal(creditLink(""), null);
  const brand = { studioName: "Wren & Co. Events", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const email = renderEmailTemplate({ key: "vendor_credits", brand, recipientName: "Maya Brooks", projectName: "Maya Brooks Wedding", values: { credits: credits.map(creditLineText), portalUrl: "https://studio-cue.com/client" } });
  assert.equal(email.subject, "Your vendor credits from Wren & Co. Events");
  assert.match(email.text, /Florals: Petal & Stem \(petalandstem\.com\)/);
  const server = read("functions/src/planning/vendor-team.ts");
  // Once per job; quiet jobs never; only after the day; the studio presses it.
  assert.match(server, /if \(existing\.exists\) return \{ emailJobId: jobId, alreadySent: true/);
  assert.match(server, /if \(project\.get\("importedAt"\) \|\| clientOutreachStop\(project\.data\(\)\) !== null\) throw new Error\("CLIENT_OUTREACH_PAUSED"\);/);
  assert.match(server, /if \(!AFTER_THE_DAY\.has\(str\(project\.get\("state"\)\)\)\) throw new Error\("VENDOR_CREDITS_AFTER_THE_DAY"\);/);
});

test("the balance is billed in time to fall due thirty days before; everyone else as before", () => {
  assert.equal(finalBillRaiseDaysBefore("planner"), 44);
  assert.equal(finalBillRaiseDaysBefore("photographer"), 28);
  assert.equal(FINAL_BILL_WINDOW_DAYS, 44);
  const wedding = (eventDate: string) => ({ state: "BOOKED", eventDate, eventKind: "wedding" });
  const today = "2026-09-30";
  const horizon = "2026-11-13";
  assert.equal(mayRaiseFinalBill(wedding("2026-11-13"), today, horizon, { trade: "planner" }), true);
  assert.equal(mayRaiseFinalBill(wedding("2026-11-13"), today, horizon, { trade: "photographer" }), false);
  assert.equal(mayRaiseFinalBill(wedding("2026-10-28"), today, horizon, { trade: "photographer" }), true);
  assert.equal(mayRaiseFinalBill(wedding("2026-10-29"), today, horizon, { trade: "dj" }), false);
});

test("the lock's sign-off waits for no planner: the walkthrough settles the details", () => {
  assert.match(read("functions/src/planning/final-details.ts"), /if \(tradeProfile\(trade\)\.journey\.walkthrough\) \{\s*tally\.walkthrough_instead/);
});
