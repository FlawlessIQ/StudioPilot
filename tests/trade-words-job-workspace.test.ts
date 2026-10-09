import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { projectThread } from "@/features/journey/thread";
import { backwardMovesFor } from "@/features/projects/going-back";
import { manualAdvanceExample, manualAdvanceFor } from "@/features/projects/manual-advance";
import { projectStateAdvanceAction, projectStateLabel } from "@/features/projects/state-label";
import { buildCrewBrief, criticalCrewQuestions } from "@/features/questionnaires/crew-brief";
import { recommendedFor, recommendedLibraryFor } from "@/features/questionnaires/recommended-templates";
import { crewQuestionsFor } from "@/features/questionnaires/template-editing";
import { describeProviderFailure } from "@/features/today/provider-failure";
import { setupGaps, setupStepName, type SetupSignals, type SetupState } from "@/features/today/setup-gaps";
import { recommendedFor as functionsRecommendedFor } from "../functions/src/planning/recommended-templates.ts";

/**
 * The job workspace in a vendor's words (docs/vendor-journeys-plan.md, 1.7).
 *
 * A hair studio's Questionnaires page told it "Before the consultation", that
 * couples fill the form in "before they pick a time to talk", and offered
 * "Any photography or filming restrictions at the venue?" to its crew
 * (2026-10-09). The job page, Today, setup and the booking brief said
 * "proposal" to studios that send a quote, and "consultation" to studios that
 * have no sales call. A photographer reads every sentence as before.
 */

const read = (path: string) => readFileSync(path, "utf8");
const PHOTO = /\b(photos?|photographs?|photography|photographers?|photographing|photographed|galler(?:y|ies)|shoots?|shooting|shot lists?|albums?|coverage|deliverables?|second shooters?|sneak peeks?|images?)\b/i;
const VENDORS = ["dj", "makeup", "hair"] as const;

test("the offer stage is a quote for makeup and hair, a proposal for everyone else", () => {
  for (const trade of [undefined, "photographer", "dj"]) {
    assert.equal(projectStateLabel("PROPOSAL", trade), "Proposal out");
    assert.equal(projectStateAdvanceAction("PROPOSAL", trade), "Confirm the proposal went out");
  }
  for (const trade of ["makeup", "hair"]) {
    assert.equal(projectStateLabel("PROPOSAL", trade), "Quote out");
    assert.equal(projectStateAdvanceAction("PROPOSAL", trade), "Confirm the quote went out");
  }
});

test("the stage card names the trade's call, or none, and its offer", () => {
  assert.equal(manualAdvanceExample("CONSULTATION"), "the consultation");
  assert.equal(manualAdvanceExample("CONSULTATION", "photographer"), "the consultation");
  assert.equal(manualAdvanceExample("CONSULTATION", "dj"), "the vibe call");
  assert.equal(manualAdvanceExample("CONSULTATION", "makeup"), "your first conversation");
  assert.equal(manualAdvanceExample("CONSULTATION", "hair"), "your first conversation");
  assert.equal(manualAdvanceExample("PROPOSAL"), "sending the proposal");
  assert.equal(manualAdvanceExample("PROPOSAL", "hair"), "sending the quote");
  assert.equal(
    manualAdvanceFor("PROPOSAL", "CONTRACT_PENDING", "p")?.detail,
    "They said yes by email, text or in person? Record it on the proposal — StudioCue keeps who accepted and when.",
  );
  assert.match(manualAdvanceFor("PROPOSAL", "CONTRACT_PENDING", "p", "makeup")?.detail ?? "", /Record it on the quote —/);
});

test("going back: to the quote for makeup and hair, and never to editing or Delivered for a vendor", () => {
  const now = "2026-10-09T12:00:00.000Z";
  const back = (state: string, trade?: string) => backwardMovesFor({ id: "p", state }, { agreementOut: false, now, trade });
  assert.equal(back("CONTRACT_PENDING")[0]?.label, "Back to the proposal");
  assert.equal(back("CONTRACT_PENDING", "dj")[0]?.label, "Back to the proposal");
  assert.equal(back("CONTRACT_PENDING", "makeup")[0]?.label, "Back to the quote");
  assert.match(back("CONTRACT_PENDING", "hair")[0]?.detail ?? "", /The quote can then be revised/);
  for (const state of ["DELIVERED", "REVIEW_REQUESTED", "CLOSED"]) {
    assert.ok(back(state).length > 0, `${state}: a photographer can still reopen`);
    for (const trade of VENDORS) assert.deepEqual(back(state, trade), [], `${trade} at ${state}`);
  }
});

const booked: JourneyInput = {
  projectId: "p1",
  state: "PLANNING",
  eventDate: "2026-12-14",
  today: "2026-10-09",
  lead: null,
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: "approved",
  scheduleHasUsableItems: true,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};
const step = (input: JourneyInput, key: string) => projectJourney(input).steps.find((item) => item.key === key);

test("the journey: solo in the trade's verb, the review unlocked by the day, the form without a call", () => {
  assert.equal(step(booked, "crew")?.detail, "Shooting this one solo");
  assert.equal(step({ ...booked, trade: "photographer" }, "crew")?.detail, "Shooting this one solo");
  assert.equal(step({ ...booked, trade: "dj" }, "crew")?.detail, "Playing this one solo");
  assert.equal(step({ ...booked, trade: "makeup" }, "crew")?.detail, "Working this one solo");
  assert.equal(step({ ...booked, trade: "hair" }, "crew")?.detail, "Working this one solo");

  assert.equal(step(booked, "album_review")?.unlock, "Unlocks after the gallery is delivered.");
  for (const trade of VENDORS) {
    const review = step({ ...booked, trade }, "album_review");
    assert.equal(review?.title, "Review");
    assert.equal(review?.unlock, "Unlocks after the event.");
    assert.equal(step({ ...booked, trade }, "delivery"), undefined, `${trade} delivers nothing`);
  }

  const fromInquiry = { ...booked, questionnaireSource: "inquiry_page" } as JourneyInput;
  assert.equal(step(fromInquiry, "schedule_form")?.detail, "The couple filled it in before the consultation");
  assert.equal(step({ ...fromInquiry, trade: "dj" }, "schedule_form")?.detail, "The couple filled it in before the vibe call");
  for (const trade of ["makeup", "hair"])
    assert.equal(step({ ...fromInquiry, trade }, "schedule_form")?.detail, "The couple filled it in with their inquiry");

  const agreementOut = { ...booked, state: "PROPOSAL", proposalStatus: "sent", contractStatus: "sent", bookingAgreementOut: true } as JourneyInput;
  assert.match(step(agreementOut, "proposal")?.detail ?? "", /signing both parts accepts the proposal$/);
  assert.match(step({ ...agreementOut, trade: "hair" }, "proposal")?.detail ?? "", /signing both parts accepts the quote$/);
});

test("the job thread names the trade's call and offer", () => {
  const base = {
    projectId: "p1",
    projectName: "Brooks wedding",
    projectCreatedAt: "2026-09-01T10:00:00.000Z",
    clientName: "Maya",
    consultations: [{ id: "c1", createdAt: "2026-09-02T10:00:00.000Z", status: "completed", completedAt: "2026-09-03T10:00:00.000Z", mode: "zoom" }],
    proposals: [
      {
        id: "q1",
        createdAt: "2026-09-04T10:00:00.000Z",
        sentAt: "2026-09-04T11:00:00.000Z",
        acceptedAt: "2026-09-05T10:00:00.000Z",
        status: "accepted",
        version: 1,
        pricingSnapshot: { totalCents: 120000, currency: "USD" },
      },
    ],
  };
  const titles = (trade?: string) => projectThread({ ...base, trade }).map((entry) => entry.title);
  const photographer = titles();
  assert.ok(photographer.includes("Consultation booked"));
  assert.ok(photographer.includes("You logged the consultation"));
  assert.ok(photographer.includes("Proposal v1 — coverage"));
  assert.ok(photographer.includes("Proposal sent to the client"));
  assert.ok(photographer.includes("Maya accepted the proposal"));
  assert.deepEqual(titles("photographer"), photographer);

  const dj = titles("dj");
  assert.ok(dj.includes("Vibe call booked") && dj.includes("You logged the vibe call"));
  assert.ok(dj.includes("Proposal v1 — service"));
  for (const trade of ["makeup", "hair"]) {
    const vendor = titles(trade);
    assert.ok(vendor.includes("Quote v1 — service"));
    assert.ok(vendor.includes("Quote sent to the client"));
    assert.ok(vendor.includes("Maya accepted the quote"));
  }
  for (const trade of VENDORS) for (const title of titles(trade)) assert.doesNotMatch(title, PHOTO, `${trade}: ${title}`);
});

const nothing: SetupState = {
  hasActivePackage: false,
  hasAgreementTemplate: true,
  hasQuestionnaireTemplate: true,
  hasConsultationAvailability: false,
  hasChosenWork: false,
  hasDecidedInquiryForm: false,
};
const waiting: SetupSignals = { projectsNeedingPackage: ["Brooks wedding"], projectsNeedingAgreement: [], projectsNeedingForm: [], openInquiries: 2 };

test("setup and Today: what you take on, the hours clients book, the quote a package prices", () => {
  const gap = (key: string, trade?: string, state: SetupState = nothing) =>
    setupGaps(state, waiting, trade).find((item) => item.key === key);
  assert.equal(gap("work")?.title, "Say what you shoot");
  assert.equal(gap("work", "photographer")?.title, "Say what you shoot");
  assert.equal(gap("availability")?.title, "Set your consultation hours");
  assert.equal(gap("availability", "dj")?.title, "Set your vibe call hours");
  assert.equal(gap("packages")?.detail, "Brooks wedding can't get a proposal until a package exists to price it.");
  assert.equal(setupStepName("work"), "what you shoot");
  assert.equal(setupStepName("availability", "dj"), "when clients can book a call");
  for (const trade of VENDORS) {
    assert.equal(gap("work", trade)?.title, "Say what you take on");
    assert.equal(setupStepName("work", trade), "what you take on");
    for (const item of setupGaps(nothing, waiting, trade)) {
      assert.doesNotMatch(`${item.title} ${item.detail}`, PHOTO, `${trade}: ${item.title}`);
    }
  }
  for (const trade of ["makeup", "hair"]) {
    assert.equal(gap("availability", trade)?.title, "Set your trial hours");
    assert.equal(setupStepName("availability", trade), "when clients can book a trial");
    assert.equal(gap("packages", trade)?.detail, "Brooks wedding can't get a quote until a package exists to price it.");
    for (const item of setupGaps({ ...nothing, hasConsultationAvailability: true }, waiting, trade))
      assert.doesNotMatch(`${item.title} ${item.detail}`, /\b(call|consultation|time to talk)\b/i, `${trade}: ${item.title}`);
  }
});

test("a failed calendar step names the trade's meeting", () => {
  assert.equal(describeProviderFailure("create_consultation_resources").title, "The consultation call wasn't booked");
  assert.equal(describeProviderFailure("create_consultation_resources", "photographer").title, "The consultation call wasn't booked");
  assert.equal(describeProviderFailure("cancel_consultation_resources", "dj").title, "The vibe call wasn't canceled");
  assert.equal(describeProviderFailure("reschedule_consultation_resources", "makeup").title, "The appointment wasn't moved");
  assert.equal(describeProviderFailure("create_consultation_resources", "hair").title, "The appointment wasn't booked");
});

test("a vendor's event details form asks no photo and video times; a photographer's still does", () => {
  // A vendor's event details form is in the library to copy, not preloaded (one form).
  const details = (trade: string) => recommendedLibraryFor(trade).find((form) => form.id === "wedding-event-details")!;
  const labels = (trade: string) => details(trade).sections.flatMap((section) => [section.title, ...section.fields.map((field) => `${field.label} ${field.help ?? ""}`)]);
  assert.ok(labels("photographer").includes("Photo and video coverage"));
  assert.ok(labels("photographer").some((label) => label.startsWith("Photo 1 / Video 1 start time")));
  for (const trade of VENDORS) {
    for (const label of labels(trade)) assert.doesNotMatch(label, PHOTO, `${trade}: ${label}`);
    // The rest of the form is the same one, in the same order.
    assert.deepEqual(
      details(trade).sections.map((section) => section.id),
      details("photographer").sections.map((section) => section.id).filter((id) => id !== "coverage"),
    );
    // The server seeds what the app shows.
    assert.deepEqual(functionsRecommendedFor(trade), recommendedFor(trade));
  }
  assert.deepEqual(functionsRecommendedFor("photographer"), recommendedFor("photographer"));
});

test("the questions crew read first: a photographer's camera questions, a vendor's own", () => {
  assert.equal(crewQuestionsFor(undefined), criticalCrewQuestions);
  assert.equal(crewQuestionsFor("photographer"), criticalCrewQuestions);
  for (const trade of VENDORS) {
    const questions = crewQuestionsFor(trade);
    assert.deepEqual(questions.map((question) => question.id), ["sensitivities", "restrictions", "accessibility"]);
    for (const question of questions) assert.doesNotMatch(question.label, PHOTO, `${trade}: ${question.label}`);
    // Still read first on the crew's brief: the ids are the ones it knows.
    const brief = buildCrewBrief({
      sections: [{ fields: questions.map((question) => ({ ...question })) }],
      answers: Object.fromEntries(questions.map((question) => [question.id, "Something"])),
    });
    assert.equal(brief.beforeYouShoot.length, questions.length);
  }
  assert.equal(crewQuestionsFor("dj").find((question) => question.id === "restrictions")?.label, "Any music rules at the venue?");
  assert.equal(crewQuestionsFor("hair").find((question) => question.id === "restrictions")?.label, "Any hair rules at the venue?");
});

test("the screens read the trade (source)", () => {
  const setting = read("components/planning/inquiry-event-form-setting.tsx");
  assert.match(setting, /const calls = tradeProfile\(workspace\.tenantTrade\)\.consultation;/);
  assert.match(setting, /calls \? `Before the \$\{callWord\}` : "With every new inquiry"/);
  assert.match(read("components/planning/recommended-questionnaires.tsx"), /Written from what working \$\{tradeVocab\(workspace\.tenantTrade\)\.provider\}s ask\./);
  assert.match(read("components/planning/questionnaire-template-editor.tsx"), /const crewQuestions = crewQuestionsFor\(trade\);/);
  // A shot list is a photographer's: the setting isn't shown to anyone else.
  assert.match(read("components/planning/planning-timeline-settings.tsx"), /\{trade\.shotList \? \(\s*<label>\s*Shot list/);
  assert.match(read("components/planning/ai-schedule-generator.tsx"), /\{`\$\{coverageWord\} starts`\}/);
  assert.match(read("components/booking/booking-autopilot-workspace.tsx"), /kindProfile\.consultation && tradeCalls \?/);
  assert.match(read("components/booking/studio-calendar.tsx"), /function meetingWord\(trade: unknown\): string/);
  assert.match(read("components/booking/project-booking-workspace.tsx"), /`Waits for the \$\{offer\}`/);
  assert.match(read("components/projects/wedding-brief.tsx"), /\$\{verb\}ing solo unless you add someone/);
  assert.match(read("components/projects/plan-areas.tsx"), /"Schedules, documents and files in one place\."/);
  assert.match(read("components/projects/live-project-detail.tsx"), /\{ agreementOut, now: new Date\(\)\.toISOString\(\), trade \}/);
  assert.match(read("components/projects/use-project-thread.ts"), /actionReceipts: mine\(actionReceipts\.records\),\s*trade,/);
  assert.match(read("components/intake/inquiry-form-editor.tsx"), /Ask for their \$\{tradeVocab\(workspace\.tenantTrade\)\.service\} budget/);
  assert.match(read("components/today/today-inbox.tsx"), /setupStepName\(setup\.next, workspace\.tenantTrade\)/);
  assert.match(read("components/setup/use-setup-state.ts"), /\}, workspace\.tenantTrade\);/);
  assert.match(read("components/setup/setup-conversation.tsx"), /Your packages are ready to use in \$\{tradeVocab\(trade\)\.proposal\.toLowerCase\(\)\}s\./);
});
