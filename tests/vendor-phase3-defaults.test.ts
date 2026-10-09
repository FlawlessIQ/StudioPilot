import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { DocumentSnapshot, Firestore } from "firebase-admin/firestore";
import { journeyFor, journeyProfile } from "../features/job-kinds/job-kinds";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { checkpointSatisfiedByEvidence, readinessEvidenceFromFacts } from "../features/readiness/checkpoint-evidence";
import { checkpointRecordSource } from "../features/readiness/checkpoint-resolution";
import { readinessScore } from "../features/readiness/score";
import { crewDemand, planCrewStaffing } from "../features/crew/staffing-plan";
import { tradeProfile } from "../features/trades/trades";
import { checkpointTemplateSchema } from "../features/workflows/schema";
import {
  INSURANCE_CHECK_KEY,
  VENDOR_JOURNEY_WAIVER,
  insuranceCheckChange,
  insuranceCheckpointTemplate,
  starterTemplates,
  weddingCheckpointDefinitions,
} from "../features/workflows/starter-templates";
import {
  insuranceCheckChange as serverInsuranceCheckChange,
  insuranceCheckpointTemplate as serverInsuranceCheckpointTemplate,
  starterTemplates as serverStarterTemplates,
} from "../functions/src/workflow/starter-templates";
import { readinessEvidenceFromFacts as serverEvidence } from "../functions/src/workflow/checkpoint-evidence";
import { readinessScore as serverReadinessScore } from "../functions/src/workflow/readiness-score";
import { crewDemand as serverCrewDemand } from "../functions/src/crew/staffing-plan";
import { autoRequestForProject } from "../functions/src/coi/automation";
import { defaultLifecycleMessagingSettings, dueLifecycleMessages } from "../functions/src/communications/lifecycle-core";

/**
 * Phase 3 of simpler vendor journeys (2026-10-09): a photographer's defaults
 * leave a vendor's jobs. Insurance only when the venue asks, crew only when
 * there is more than one person, four readiness checks instead of twelve.
 * Every test holds a photographer exactly where they were.
 */

const VENDORS = ["dj", "makeup", "hair"] as const;
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** What onboarding seeds for a trade (functions/src/saas/onboarding.ts). */
const seeded = (trade: string) => {
  const shape = tradeProfile(trade);
  return shape.journey.readiness === "essentials"
    ? starterTemplates("essentials", {
        balanceDueDaysBefore: shape.balanceDueDaysBefore,
        balanceOnTheDay: shape.journey.balanceOnTheDay,
      })
    : starterTemplates();
};
const wedding = (trade: string) => seeded(trade).find((template) => template.eventTypeId === "wedding")!;

// ── Four checks ─────────────────────────────────────────────────────────

test("a vendor's wedding starts with four checks, in a vendor's words and due when they can be", () => {
  for (const trade of VENDORS) {
    const checks = wedding(trade).checkpointTemplates;
    assert.deepEqual(
      checks.map((check) => check.key).sort(),
      ["contract-completed", "final-balance", "questionnaire-complete", "schedule-approved"],
      trade,
    );
    const by = (key: string) => checks.find((check) => check.key === key)!;
    assert.equal(by("contract-completed").name, "Booked");
    assert.equal(by("questionnaire-complete").name, "Planning form in");
    assert.equal(by("schedule-approved").name, "The day's plan set");
    assert.equal(by("final-balance").name, "Balance paid");
    // Not before the planner (thirty days) or party list (thirty-seven) is due back.
    assert.equal(by("questionnaire-complete").dueDateRule.offsetDays, -30, trade);
    // A DJ's plan follows the final planning call, a week out. Nobody approves
    // a vendor's plan: the studio sets it, and the client can still see it.
    assert.equal(by("schedule-approved").dueDateRule.offsetDays, -7, trade);
    assert.equal(by("schedule-approved").ownerType, "studio", trade);
    assert.equal(by("schedule-approved").visibility, "shared", trade);
    for (const check of checks) {
      assert.doesNotMatch(check.description, /must be verified/, `${trade} ${check.key}`);
      assert.equal(checkpointTemplateSchema.safeParse(check).success, true, `${trade} ${check.key}`);
      assert.deepEqual(check.dependencies, [], `${trade} ${check.key}`);
    }
    // In the order they fall due.
    const offsets = checks.map((check) => check.dueDateRule.offsetDays);
    assert.deepEqual(offsets, [...offsets].sort((left, right) => left - right), trade);
    assert.equal(wedding(trade).name, "Wedding");
    assert.match(wedding(trade).description, /^Before the day: booked, planning form in, .+\.$/);
  }
});

test("the balance is due when the trade is paid: a DJ's two weeks out, a makeup artist's on the morning", () => {
  const balance = (trade: string) => wedding(trade).checkpointTemplates.find((check) => check.key === "final-balance")!;
  assert.equal(balance("dj").dueDateRule.offsetDays, -14);
  assert.equal(balance("dj").blocking, true);
  for (const trade of ["makeup", "hair"]) {
    // Collected on the day: on the list, never a blocker for being ready for it.
    assert.ok(Object.is(balance(trade).dueDateRule.offsetDays, 0), trade);
    assert.equal(balance(trade).blocking, false, trade);
  }
});

test("a family session's form keeps its own week; other kinds carry only the essentials they had", () => {
  const types = (trade: string) => Object.fromEntries(seeded(trade).map((template) => [template.eventTypeId, template]));
  const makeup = types("makeup");
  assert.deepEqual(makeup.portraits!.checkpointTemplates.map((check) => [check.key, check.dueDateRule.offsetDays]), [["questionnaire-complete", -7]]);
  assert.deepEqual(makeup.sports!.checkpointTemplates.map((check) => check.key), ["schedule-approved"]);
  assert.deepEqual(makeup.corporate!.checkpointTemplates.map((check) => check.key).sort(), ["contract-completed", "questionnaire-complete", "schedule-approved"]);
  for (const template of seeded("dj")) {
    assert.ok(template.description.length >= 10, template.eventTypeId);
    assert.doesNotMatch(template.description, /shoot|crew|delivery/i, template.eventTypeId);
  }
});

test("a photographer's twelve are exactly as they were", () => {
  const photo = wedding("photographer");
  assert.equal(photo.name, "Wedding Photography");
  assert.deepEqual(
    photo.checkpointTemplates.map((check) => [check.key, check.name, check.ownerType, check.dueDateRule.offsetDays, check.blocking]),
    weddingCheckpointDefinitions.map(([key, name, , owner, offset]) => [key, name, owner, offset, true]),
  );
  assert.deepEqual(seeded("photographer"), starterTemplates());
  assert.deepEqual(seeded(undefined as unknown as string), starterTemplates());
});

test("the functions copy of the essentials and the certificate check agree", () => {
  for (const trade of ["photographer", ...VENDORS]) {
    const shape = tradeProfile(trade);
    const options = { balanceDueDaysBefore: shape.balanceDueDaysBefore, balanceOnTheDay: shape.journey.balanceOnTheDay };
    assert.deepEqual(serverStarterTemplates("essentials", options), starterTemplates("essentials", options), trade);
  }
  assert.deepEqual(serverInsuranceCheckpointTemplate(), insuranceCheckpointTemplate());
  for (const checks of [
    [{ id: "c1", templateKey: "contract-completed", status: "ready" }],
    [{ id: "c2", templateKey: INSURANCE_CHECK_KEY, status: "waived", waiverReason: VENDOR_JOURNEY_WAIVER }],
  ]) {
    const job = { insuranceByDefault: false, insuranceRequired: "required", checks };
    assert.deepEqual(serverInsuranceCheckChange(job), insuranceCheckChange(job));
  }
});

test("onboarding seeds a vendor's four, dated by how the trade is paid, and a photographer's twelve", () => {
  const onboarding = read("functions/src/saas/onboarding.ts");
  assert.match(onboarding, /starterTemplates\("essentials", \{\s*balanceDueDaysBefore: trade\.balanceDueDaysBefore,\s*balanceOnTheDay: trade\.journey\.balanceOnTheDay,/);
  assert.match(onboarding, /: starterTemplates\(\);/);
});

// ── The records answer the four ────────────────────────────────────────

const doneFacts = {
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: "paid",
  questionnaireStatus: "submitted",
  questionnaireAnswers: { party: "Bride, two bridesmaids" },
  // Published, not approved: nobody approves a vendor's plan.
  scheduleStatus: "published",
  scheduleItems: [{ startAt: "2027-06-12T13:00:00.000Z", title: "Bride in the chair" }],
  crewAccepted: 0,
  crewRequired: 0,
  crewAcknowledgedCurrent: 0,
  coiStatus: null,
  insuranceRequired: "unknown",
  bookingConfirmed: true,
};
const asCheckpoints = (trade: string) =>
  wedding(trade).checkpointTemplates.map((check) => ({
    status: "ready",
    blocking: check.blocking,
    completionMethod: check.completionMethod,
    templateKey: check.key,
  }));
const NOW = "2027-06-01T12:00:00.000Z";

test("the job's own records finish all four checks, on both sides of the wire", () => {
  for (const trade of VENDORS) {
    const evidence = readinessEvidenceFromFacts(doneFacts);
    for (const check of wedding(trade).checkpointTemplates)
      assert.equal(checkpointSatisfiedByEvidence({ completionMethod: check.completionMethod, templateKey: check.key }, evidence), true, `${trade} ${check.key}`);
    assert.deepEqual(readinessScore(asCheckpoints(trade), NOW, evidence), { tracked: true, percent: 100, totalRequired: wedding(trade).checkpointTemplates.filter((check) => check.blocking).length, satisfiedRequired: wedding(trade).checkpointTemplates.filter((check) => check.blocking).length });
    assert.deepEqual(serverReadinessScore(asCheckpoints(trade), NOW, serverEvidence(doneFacts)), readinessScore(asCheckpoints(trade), NOW, evidence), trade);
  }
});

test("a makeup artist with the balance still to collect on the morning is ready for it", () => {
  const evidence = readinessEvidenceFromFacts({ ...doneFacts, finalInvoiceStatus: "sent" });
  const makeup = readinessScore(asCheckpoints("makeup"), NOW, evidence);
  assert.deepEqual(makeup, { tracked: true, percent: 100, totalRequired: 3, satisfiedRequired: 3 });
  // A DJ's balance is invoiced and due before the night, so it still counts.
  assert.equal(readinessScore(asCheckpoints("dj"), NOW, evidence).percent, 75);
});

test("the readiness list sends a vendor to their own form and plan; a photographer's reads as before", () => {
  assert.deepEqual(checkpointRecordSource("questionnaire-complete"), { label: "Send the questionnaire", path: "/studio/questionnaires" });
  assert.deepEqual(checkpointRecordSource("schedule-approved", "photographer"), { label: "Build the run of show", path: "/studio/schedules" });
  assert.equal(checkpointRecordSource("questionnaire-complete", "makeup")?.label, "Send the party list");
  assert.equal(checkpointRecordSource("schedule-approved", "hair")?.label, "Build the getting-ready schedule");
  assert.equal(checkpointRecordSource("questionnaire-complete", "dj")?.label, "Send the music & moments planner");
  assert.equal(checkpointRecordSource("schedule-approved", "dj")?.label, "Build the run of show & MC script");
});

// ── Insurance only when the venue asks ─────────────────────────────────

test("a vendor's job gains the certificate check only when its venue asks; a photographer's is never touched", () => {
  const essentials = [
    { id: "c1", templateKey: "contract-completed", status: "ready" },
    { id: "c2", templateKey: "questionnaire-complete", status: "ready" },
  ];
  const vendor = { insuranceByDefault: tradeProfile("makeup").journey.insuranceByDefault, checks: essentials };
  assert.deepEqual(insuranceCheckChange({ ...vendor, insuranceRequired: "required" }), { kind: "add" });
  for (const answer of ["unknown", "not_required", null, undefined])
    assert.equal(insuranceCheckChange({ ...vendor, insuranceRequired: answer }), null, String(answer));
  // Already carried — open, done, or waived by a person for their own reason: never twice.
  for (const carried of [
    { status: "ready" },
    { status: "complete" },
    { status: "failed" },
    { status: "waived", waiverReason: "The venue confirmed they have our certificate on file" },
  ])
    assert.equal(
      insuranceCheckChange({ ...vendor, insuranceRequired: "required", checks: [...essentials, { id: "c9", templateKey: INSURANCE_CHECK_KEY, ...carried }] }),
      null,
      JSON.stringify(carried),
    );
  // Set aside by the vendor backfill, and now the venue asks: taken back up.
  assert.deepEqual(
    insuranceCheckChange({
      ...vendor,
      insuranceRequired: "required",
      checks: [...essentials, { id: "c9", templateKey: INSURANCE_CHECK_KEY, status: "waived", waiverReason: VENDOR_JOURNEY_WAIVER }],
    }),
    { kind: "reopen", id: "c9" },
  );
  // A photographer's starter wedding carries it from the start, and a
  // template the studio edited it out of stays as they left it.
  assert.equal(tradeProfile("photographer").journey.insuranceByDefault, true);
  assert.equal(insuranceCheckChange({ insuranceByDefault: true, insuranceRequired: "required", checks: [] }), null);
  assert.ok(wedding("photographer").checkpointTemplates.some((check) => check.key === INSURANCE_CHECK_KEY));
});

test("the added check is a photographer's certificate check: same key, method, date, and the same evidence finishes it", () => {
  const check = insuranceCheckpointTemplate();
  const photographer = wedding("photographer").checkpointTemplates.find((candidate) => candidate.key === INSURANCE_CHECK_KEY)!;
  assert.equal(check.key, INSURANCE_CHECK_KEY);
  assert.equal(check.name, "Insurance to the venue");
  for (const field of ["completionMethod", "dueDateRule", "blocking", "ownerType", "waiverAllowed"] as const)
    assert.deepEqual(check[field], photographer[field], field);
  assert.equal(checkpointTemplateSchema.safeParse(check).success, true);
  const sent = readinessEvidenceFromFacts({ ...doneFacts, insuranceRequired: "required", coiStatus: "sent_to_venue" });
  const waiting = readinessEvidenceFromFacts({ ...doneFacts, insuranceRequired: "required", coiStatus: "requested" });
  const notNeeded = readinessEvidenceFromFacts({ ...doneFacts, insuranceRequired: "not_required" });
  const finishes = (evidence: typeof sent) => checkpointSatisfiedByEvidence({ completionMethod: check.completionMethod, templateKey: check.key }, evidence);
  assert.equal(finishes(sent), true);
  assert.equal(finishes(waiting), false);
  // Switched off again: the venue does not want one, so it no longer holds the job.
  assert.equal(finishes(notNeeded), true);
});

const journeyBase = (trade: string): JourneyInput => ({
  projectId: "p1",
  state: "PLANNING",
  eventDate: "2027-06-12",
  today: "2027-03-01",
  lead: null,
  hasConsultation: false,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
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
  trade,
  trial: tradeProfile(trade).trial ? { state: "not_booked", startsAt: null } : null,
  finalCall: tradeProfile(trade).planning ? { state: "not_yet", lockOn: "2027-05-13", startsAt: null } : undefined,
});
const keys = (input: JourneyInput) => projectJourney(input).steps.map((step) => step.key as string);

test("a solo makeup artist's wedding has no crew and no insurance — until she turns insurance on", () => {
  for (const trade of VENDORS) {
    const solo = keys(journeyBase(trade));
    assert.ok(!solo.includes("crew"), `${trade}: ${solo.join(", ")}`);
    assert.ok(!solo.includes("coi"), `${trade}: ${solo.join(", ")}`);
    assert.ok(keys({ ...journeyBase(trade), insuranceRequired: "required" }).includes("coi"), trade);
    // A certificate already under way stays, whatever the answer says.
    assert.ok(keys({ ...journeyBase(trade), coiStatus: "requested" }).includes("coi"), trade);
    // More than one person: the crew step is back.
    assert.ok(keys({ ...journeyBase(trade), crewRequired: 2 }).includes("crew"), trade);
  }
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("makeup"), { insuranceRequired: "required" }).coi, true);
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("makeup")).crew, false);
});

test("a photographer's wedding still has its crew and insurance steps with nothing answered", () => {
  const photo = keys(journeyBase("photographer"));
  assert.ok(photo.includes("crew"));
  assert.ok(photo.includes("coi"));
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("photographer")).crew, true);
  assert.equal(journeyFor(journeyProfile("wedding"), tradeProfile("photographer")).coi, true);
});

test("no certificate is asked for on a vendor's job whose venue hasn't asked", async () => {
  const job = (insuranceRequired: string) =>
    ({
      id: "p1",
      get: (field: string) =>
        ({ tenantId: "t1", eventDate: "2027-06-12", state: "PLANNING", insuranceRequired })[field],
      data: () => ({ tenantId: "t1", eventDate: "2027-06-12", state: "PLANNING", insuranceRequired }),
    }) as unknown as DocumentSnapshot;
  // Nothing is read: the answer stops it first.
  const db = {} as Firestore;
  for (const answer of ["unknown", "not_required", ""])
    assert.equal(await autoRequestForProject(db, job(answer), "2027-04-20T12:00:00.000Z"), "not_required", answer);
});

// ── Crew only when needed ──────────────────────────────────────────────

test("a one-person package the owner works needs nobody; a bigger one books the rest, as today", () => {
  const solo = [{ role: "makeup_artist" as const, count: 1 }];
  for (const demand of [crewDemand({ coverage: solo, assignments: [] }), serverCrewDemand({ coverage: solo, assignments: [] })]) {
    assert.equal(demand.crewRequired, 0);
    assert.equal(demand.packageNeedsCrew, false);
    assert.deepEqual(demand.open, []);
  }
  const plan = planCrewStaffing({ coverage: solo, eventSpecialty: "weddings", serviceArea: "", startsAt: "2027-06-12T12:00:00.000Z", endsAt: "2027-06-12T16:00:00.000Z", candidates: [] });
  assert.equal(plan.toBook, 0);
  assert.deepEqual(plan.roles, []);
  const team = crewDemand({ coverage: [{ role: "makeup_artist", count: 3 }], assignments: [] });
  assert.equal(team.crewRequired, 2);
  assert.deepEqual(team.open.map((role) => role.role), ["Second makeup artist", "Makeup artist 3"]);
  // "Not me this time": the one person is someone to book.
  assert.equal(crewDemand({ coverage: solo, assignments: [], ownerCovers: false }).crewRequired, 1);
});

test("the job page asks a solo vendor for nobody, and offers the venue's insurance switch", () => {
  const page = read("components/projects/live-project-detail.tsx");
  assert.equal(page.match(/solo=\{soloVendorJob\}/g)?.length, 2);
  assert.equal(page.match(/crewByDefault=\{jobShape\.crew\}/g)?.length, 2);
  assert.match(page, /!tradeJourney\.crewByDefault && !journey\.steps\.some\(\(step\) => step\.key === "crew"\)/);
  assert.match(page, /<span>Our venue needs insurance<\/span>/);
  assert.match(page, /sendPlanningCommand\("setInsuranceRequirement", \{\s*projectId,\s*insuranceRequired: next \? "required" : "not_required",/);
  assert.match(page, /!tradeJourney\.insuranceByDefault &&\s*projectProfile\(project\)\.coi/);
  assert.equal(page.match(/\{insuranceSwitchEl\}/g)?.length, 2);
});

test("readiness adds the check when the venue asks, for a vendor only, and recomputes on the answer", () => {
  const triggers = read("functions/src/workflow/readiness-triggers.ts");
  assert.match(triggers, /const insuranceAnswered =\s*before !== undefined &&/);
  assert.match(triggers, /!\(await leavesInsuranceToTheVenue\(db, where\.tenantId\)\)/);
  assert.match(triggers, /transaction\.create\(insuranceReference, checkpoint\);/);
  assert.match(triggers, /insuranceSnapshot\.get\("waiverReason"\) === VENDOR_JOURNEY_WAIVER/);
  assert.match(triggers, /return `\$\{workflowRunId\}_\$\{INSURANCE_CHECK_KEY\}`;/);
});

// ── Routine steps folded, not lost ─────────────────────────────────────

test("a DJ's day-before note is still drafted for approval, and the night speaks for it", () => {
  const due = dueLifecycleMessages({
    project: { id: "p1", tenantId: "t1", state: "READY", eventDate: "2027-06-12" },
    settings: defaultLifecycleMessagingSettings,
    today: "2027-06-11",
  });
  assert.ok(due.some((message) => message.trigger === "day_before_checklist"));
  assert.equal(defaultLifecycleMessagingSettings.day_before_checklist.autoSend, false);
  assert.equal(tradeProfile("dj").clientDayBefore, true);
  // The planner in and the night's plan out: the day before is what is left.
  const night: JourneyInput = {
    ...journeyBase("dj"),
    state: "READY",
    today: "2027-06-11",
    questionnaireStatus: "submitted",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleHasUsableItems: true,
    finalCall: { state: "held", lockOn: "2027-06-02", startsAt: null },
  };
  for (const [status, label] of [
    [null, "Draft the checklist"],
    ["review_required", "Approve the checklist"],
  ] as const) {
    const steps = projectJourney({ ...night, dayBeforeDraftStatus: status }).steps;
    assert.ok(!steps.some((step) => step.key === "day_before"));
    assert.equal(steps.find((step) => step.key === "event_day")?.action?.label, label, String(status));
  }
});

test("the backfill is dry by default, names its studios, and never waives what is done or what the venue asked for", () => {
  const script = read("scripts/backfill-vendor-readiness.mts");
  assert.match(script, /const apply = args\.includes\("--apply"\);/);
  assert.match(script, /if \(!tenantIds\.length\) \{/);
  assert.match(script, /trade\.journey\.readiness !== "essentials"/);
  assert.equal(VENDOR_JOURNEY_WAIVER, "Not part of a vendor's journey");
  assert.match(script, /const NOTE = VENDOR_JOURNEY_WAIVER;/);
  assert.match(script, /if \(status === "complete" \|\| status === "waived"\) continue;/);
  assert.match(script, /key === INSURANCE_CHECK_KEY && insuranceAsked/);
  assert.match(script, /starterTemplates\("essentials", \{\s*balanceDueDaysBefore: trade\.balanceDueDaysBefore,/);
});
