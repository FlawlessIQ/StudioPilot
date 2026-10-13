import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  matchableWording,
  resolveAnswers,
  resolvedAnswerRecord,
  resolvedFor,
  responseCounts,
  type ResolvableResponse,
} from "../features/questionnaires/resolved-answers";

/**
 * One answer per question across a job's forms (GR Productions, 2026-10-13:
 * fields captured earlier showed as TBD later in the journey).
 */

const section = (fields: Array<[string, string, string?]>) => ({
  sections: [{ id: "s", fields: fields.map(([id, label, type]) => ({ id, label, type: type ?? "time" })) }],
});
const eventDetails = (answers: Record<string, unknown>, overrides: Partial<ResolvableResponse> = {}): ResolvableResponse => ({
  id: "event_details",
  status: "submitted",
  templateName: "Event details",
  submittedAt: "2026-06-01T12:00:00.000Z",
  templateSnapshot: section([
    ["bridal-prep-start", "Bridal prep start time"],
    ["coverageStartTime", "Photo 1 / Video 1 start time"],
    ["notes", "Notes", "long_text"],
  ]),
  answers,
  ...overrides,
});
const finalSchedule = (answers: Record<string, unknown>, overrides: Partial<ResolvableResponse> = {}): ResolvableResponse => ({
  id: "final_schedule",
  status: "submitted",
  templateName: "Final schedule",
  submittedAt: "2026-10-01T12:00:00.000Z",
  templateSnapshot: section([
    ["bridal-prep-start", "Bridal prep start time"],
    ["coverageStartTime", "Photo 1 / Video 1 start time"],
    ["notes", "Notes", "long_text"],
  ]),
  answers,
  ...overrides,
});

test("Gabe's case: TBD at the inquiry, settled on the final schedule — the settled answer is the answer everywhere", () => {
  const resolved = resolveAnswers([eventDetails({ "bridal-prep-start": "TBD", coverageStartTime: "TBD" }), finalSchedule({ "bridal-prep-start": "10:00", coverageStartTime: "12:30" })]);
  const prep = resolvedFor(resolved, "event_details", "bridal-prep-start");
  assert.equal(prep?.status, "answered");
  assert.equal(prep?.value, "10:00");
  assert.equal(prep?.formName, "Final schedule");
  assert.equal(resolvedAnswerRecord(resolved).coverageStartTime, "12:30");
});

test("TBD never overrides a real answer, whichever came later", () => {
  // A real time at the inquiry, a TBD later: the real time stands.
  const resolved = resolveAnswers([eventDetails({ "bridal-prep-start": "10:00" }), finalSchedule({ "bridal-prep-start": "tbd" })]);
  assert.equal(resolvedFor(resolved, "final_schedule", "bridal-prep-start")?.value, "10:00");
  // Only TBD anywhere: it reads as TBD, not as missing.
  const open = resolveAnswers([eventDetails({ "bridal-prep-start": "TBD" })]);
  assert.equal(resolvedFor(open, "event_details", "bridal-prep-start")?.status, "tbd");
});

test("timed by when the field was answered, not when its form was last touched", () => {
  // The studio fixed a typo on the old form after the final schedule came in:
  // the old form's TBD must not come back over the real time.
  const resolved = resolveAnswers([
    eventDetails(
      { "bridal-prep-start": "TBD", coverageStartTime: "11:00" },
      {
        updatedAt: "2026-10-05T00:00:00.000Z",
        answerProvenance: { coverageStartTime: { sourceType: "studio_answer", changedAt: "2026-10-05T00:00:00.000Z" } },
      },
    ),
    finalSchedule({ "bridal-prep-start": "10:00", coverageStartTime: "12:30" }),
  ]);
  assert.equal(resolvedFor(resolved, "event_details", "bridal-prep-start")?.value, "10:00");
  // The studio's correction is the newest real answer to that question.
  assert.equal(resolvedFor(resolved, "event_details", "coverageStartTime")?.value, "11:00");
  assert.equal(resolvedFor(resolved, "event_details", "coverageStartTime")?.by, "studio");
});

test("a couple's amendment to a returned form is the newest answer, though the form keeps its first sent date", () => {
  const resolved = resolveAnswers([
    eventDetails(
      { "bridal-prep-start": "09:30" },
      { answerProvenance: { "bridal-prep-start": { sourceType: "client_answer", changedAt: "2026-10-09T00:00:00.000Z" } } },
    ),
    finalSchedule({ "bridal-prep-start": "10:00" }),
  ]);
  assert.equal(resolvedFor(resolved, "final_schedule", "bridal-prep-start")?.value, "09:30");
});

test("a prefilled value is never a source, only what a person answered", () => {
  const resolved = resolveAnswers([
    eventDetails({ "bridal-prep-start": "09:00" }),
    finalSchedule(
      { "bridal-prep-start": "08:00" },
      { answerProvenance: { "bridal-prep-start": { sourceType: "suggested_time", changedAt: "2026-10-01T00:00:00.000Z" } } },
    ),
  ]);
  assert.equal(resolvedFor(resolved, "final_schedule", "bridal-prep-start")?.value, "09:00");
});

test("the same question worded the same on an imported form is one question; generic and free-text ones aren't", () => {
  const imported: ResolvableResponse = {
    id: "imported",
    status: "submitted",
    submittedAt: "2026-09-01T00:00:00.000Z",
    templateSnapshot: section([["q_17", "Bridal Prep Start Time", "text"], ["q_18", "Notes", "text"]]),
    answers: { q_17: "9:45 AM", q_18: "Imported note" },
  };
  const resolved = resolveAnswers([eventDetails({ "bridal-prep-start": "TBD", notes: "Inquiry note" }), imported]);
  assert.equal(resolvedFor(resolved, "event_details", "bridal-prep-start")?.value, "9:45 AM");
  // "Notes" isn't merged across forms: each form keeps its own.
  assert.equal(resolvedFor(resolved, "event_details", "notes")?.value, "Inquiry note");
  assert.equal(resolvedFor(resolved, "imported", "q_18")?.value, "Imported note");
  assert.equal(matchableWording({ label: "Notes", type: "text" }), "");
  assert.equal(matchableWording({ label: "Anything else", type: "text" }), "");
  assert.equal(matchableWording({ label: "Tell us about your day", type: "long_text" }), "");
  assert.equal(matchableWording({ label: "Ceremony start time", type: "time" }), "ceremony start time");
});

test("only forms sent back count: a draft, a reopened form mid-edit or a withdrawn one says nothing", () => {
  assert.equal(responseCounts({ id: "a", status: "draft" }), false);
  assert.equal(responseCounts({ id: "a", status: "submitted" }), true);
  assert.equal(responseCounts({ id: "a", status: "locked" }), true);
  // Reopened for a change: its half-typed edits are nobody's answer yet (review, 2026-10-13).
  assert.equal(responseCounts({ id: "a", status: "reopened", submittedAt: "2026-06-01T00:00:00.000Z" }), false);
  assert.equal(responseCounts({ id: "a", status: "withdrawn", submittedAt: "2026-06-01T00:00:00.000Z" }), false);
  assert.equal(responseCounts({ id: "a", status: "submitted", archivedAt: "2026-06-01T00:00:00.000Z" }), false);
  const resolved = resolveAnswers([eventDetails({ "bridal-prep-start": "10:00" }), finalSchedule({ "bridal-prep-start": "11:00" }, { status: "sent", submittedAt: null })]);
  assert.equal(resolvedFor(resolved, "event_details", "bridal-prep-start")?.value, "10:00");
});

test("deterministic whatever order the forms are read in", () => {
  const forms = [eventDetails({ "bridal-prep-start": "TBD" }), finalSchedule({ "bridal-prep-start": "10:00" })];
  assert.deepEqual([...resolveAnswers(forms).byKey], [...resolveAnswers([...forms].reverse()).byKey]);
});

test("the functions copy is the same file", () => {
  assert.equal(readFileSync("functions/src/planning/resolved-answers.ts", "utf8"), readFileSync("features/questionnaires/resolved-answers.ts", "utf8"));
});

// ─── The readers ─────────────────────────────────────────────────────────────

import { answersAsSettled, answersResolvedFor, formFreshness, jobAnswerRecord } from "../features/questionnaires/resolved-answers";
import { answersChanged, formJustReturned } from "../functions/src/planning/crew-brief-trigger";

const read = (path: string) => readFileSync(path, "utf8");

test("the run of show: a typo fixed on the old form doesn't bring its TBDs back", () => {
  const forms = [
    eventDetails({ "bridal-prep-start": "TBD", coverageStartTime: "TBD" }, { updatedAt: "2026-10-09T00:00:00.000Z" }),
    finalSchedule({ "bridal-prep-start": "10:00", coverageStartTime: "12:30" }, { updatedAt: "2026-10-01T12:00:00.000Z" }),
  ];
  const answers = jobAnswerRecord(forms);
  assert.equal(answers["bridal-prep-start"], "10:00");
  assert.equal(answers.coverageStartTime, "12:30");
  // A form still being filled in fills only what nothing sent back answers, and never with a TBD over a time.
  const drafting = jobAnswerRecord([
    eventDetails({ "bridal-prep-start": "10:00" }),
    { ...finalSchedule({ "bridal-prep-start": "TBD", "first-look": "13:00" }), status: "sent", submittedAt: null, templateSnapshot: section([["bridal-prep-start", "Bridal prep start time"], ["first-look", "First look"]]) },
  ]);
  assert.equal(drafting["bridal-prep-start"], "10:00");
  assert.equal(drafting["first-look"], "13:00");
});

test("a form's freshness: what it left TBD that another form settled, and what is still open", () => {
  const event = eventDetails({ "bridal-prep-start": "TBD", coverageStartTime: "TBD" });
  const resolved = resolveAnswers([event, finalSchedule({ "bridal-prep-start": "10:00" })]);
  const freshness = formFreshness(resolved, event);
  assert.deepEqual(freshness.settled.map((item) => [item.fieldId, item.value, item.formName]), [["bridal-prep-start", "10:00", "Final schedule"]]);
  assert.deepEqual(freshness.open.map((item) => item.fieldId), ["coverageStartTime"]);
  assert.equal(answersAsSettled(resolved, event)["bridal-prep-start"], "10:00");
  assert.equal(answersAsSettled(resolved, event).coverageStartTime, "TBD");
  // Every question on the form carries the job's answer, for printed rows.
  assert.equal(answersResolvedFor(resolved, finalSchedule({ "bridal-prep-start": "10:00" }))["bridal-prep-start"], "10:00");
});

test("the form trigger: any changed answer counts; a review or reminder written onto the form doesn't", () => {
  const form = { tenantId: "t", projectId: "p", status: "submitted", answers: { "bridal-prep-start": "TBD" } };
  assert.equal(answersChanged(form, { ...form, answers: { "bridal-prep-start": "10:00" } }), true);
  assert.equal(answersChanged(form, { ...form, aiReview: { status: "superseded" } }), false);
  assert.equal(answersChanged(form, { ...form, lastReminderAt: "2026-10-13T00:00:00.000Z" }), false);
  // A couple fixing a time on a returned form refreshes a sign-off awaiting them.
  assert.equal(formJustReturned(form, { ...form, answers: { "bridal-prep-start": "10:00" } }), true);
  assert.equal(formJustReturned(form, { ...form, aiReview: { status: "ready" } }), false);
});

test("wired: every reader takes the job's answers from the one resolver", () => {
  const review = read("functions/src/operations/ai-pdf.ts");
  assert.match(review, /resolveAnswers\(/);
  assert.match(review, /settledOnOtherForms:/);
  assert.match(read("functions/src/planning/questionnaire-review-facts.ts"), /settledOnOtherForms are what the studio already knows/);
  assert.match(read("components/planning/questionnaire-review-insights.tsx"), /formFreshness\(resolved,/);
  assert.match(read("components/planning/questionnaire-review-insights.tsx"), /review\.allSettled \? null/);
  assert.match(read("components/planning/ai-schedule-generator.tsx"), /jobAnswerRecord\(/);
  assert.match(read("functions/src/planning/final-details.ts"), /answersResolvedFor\(resolved,/);
  assert.match(read("functions/src/contracts/sources.ts"), /answersResolvedFor\(resolved,/);
  assert.match(read("components/projects/wedding-brief.tsx"), /answersResolvedFor\(resolved,/);
  assert.match(read("functions/src/ai/copilot.ts"), /answersResolvedFor\(resolved, item\)/);
  assert.match(read("functions/src/ai/schedule.ts"), /answersResolvedFor\(resolvedForms,/);
  assert.match(read("functions/src/planning/job-facts.ts"), /earlier\.sort\(\(left, right\) => text\(right\.answeredAt\)/);
  const trigger = read("functions/src/planning/crew-brief-trigger.ts");
  assert.match(trigger, /if \(!answersChanged\(event\.data\?\.before\?\.data\(\), after\)\) return;/);
  assert.match(trigger, /syncJobAnswers\(getFirestore\(\)/);
  const sync = read("functions/src/planning/job-answers-sync.ts");
  assert.match(sync, /answers: answersAsSettled\(resolved, response\)/);
  assert.match(sync, /ai_planning_followup_\$\{response\.id\}/);
  assert.match(sync, /status: "superseded"/);
  // A decided action is never reopened or overwritten.
  assert.match(sync, /\["review_required", "draft", "pending"\]\.includes/);
});

test("the day plan reads a real answer over a TBD alias", () => {
  assert.match(read("features/schedules/day-plan.ts"), /if \(!isTbdAnswer\(value\)\) return value\.trim\(\);/);
});

// ─── What review found (2026-10-13) ─────────────────────────────────────────

import { flagMentions, reviewSettled } from "../features/questionnaires/resolved-answers";

test("a prefill the couple kept beats a TBD, and loses to anything typed", () => {
  const event = eventDetails({ "bridal-prep-start": "TBD", coverageStartTime: "TBD" });
  const final = finalSchedule(
    { "bridal-prep-start": "09:30", coverageStartTime: "12:00" },
    {
      answerProvenance: {
        "bridal-prep-start": { sourceType: "suggested_time", changedAt: "2026-10-01T00:00:00.000Z" },
        coverageStartTime: { sourceType: "project_fact", changedAt: "2026-10-01T00:00:00.000Z" },
      },
    },
  );
  const resolved = resolveAnswers([event, final]);
  // The final schedule prints the kept values, never the inquiry's TBD.
  assert.equal(answersResolvedFor(resolved, final)["bridal-prep-start"], "09:30");
  assert.equal(answersResolvedFor(resolved, final).coverageStartTime, "12:00");
  assert.equal(resolvedFor(resolved, "event_details", "bridal-prep-start")?.prefilled, true);
  // Something typed anywhere outranks the kept prefill, even if older.
  const typed = resolveAnswers([eventDetails({ "bridal-prep-start": "08:45" }), final]);
  assert.equal(resolvedFor(typed, "final_schedule", "bridal-prep-start")?.value, "08:45");
});

test("a TBD never replaces a real value a form holds when printing it", () => {
  const final = finalSchedule({ "bridal-prep-start": "09:30" }, { answerProvenance: { "bridal-prep-start": { sourceType: "earlier_answer" } } });
  const resolved = resolveAnswers([eventDetails({ "bridal-prep-start": "TBD" }, { submittedAt: "2026-11-01T00:00:00.000Z" }), final]);
  assert.equal(answersResolvedFor(resolved, final)["bridal-prep-start"], "09:30");
});

test("a shared field id is one question only when the wording matches too", () => {
  const invited: ResolvableResponse = {
    id: "event",
    status: "submitted",
    submittedAt: "2026-11-01T00:00:00.000Z",
    templateSnapshot: section([["guest-count", "Number of invited guests", "text"]]),
    answers: { "guest-count": "150" },
  };
  const final: ResolvableResponse = {
    id: "final",
    status: "submitted",
    submittedAt: "2026-10-01T00:00:00.000Z",
    templateSnapshot: section([["guest-count", "Final guest count", "text"]]),
    answers: { "guest-count": "132" },
  };
  const resolved = resolveAnswers([invited, final]);
  assert.equal(resolvedFor(resolved, "final", "guest-count")?.value, "132");
  assert.equal(resolvedFor(resolved, "event", "guest-count")?.value, "150");
});

test("the day plan's fallback takes the newest form's value", () => {
  const record = jobAnswerRecord([
    { id: "old", status: "sent", updatedAt: "2026-06-01T00:00:00.000Z", answers: { venue: "Old venue" } },
    { id: "new", status: "sent", updatedAt: "2026-09-01T00:00:00.000Z", answers: { venue: "New venue" } },
  ]);
  assert.equal(record.venue, "New venue");
});

test("a review is settled only when written before the answers, with no contradiction or risk, and every missing item answered", () => {
  const event = eventDetails({ "bridal-prep-start": "TBD" });
  const resolved = resolveAnswers([event, finalSchedule({ "bridal-prep-start": "10:00" })]);
  const freshness = formFreshness(resolved, event);
  const review = { generatedAt: "2026-06-02T00:00:00.000Z", missingInformation: ["Bridal prep start time"], contradictions: [], planningRisks: [] };
  assert.equal(reviewSettled(freshness, review), true);
  assert.equal(reviewSettled(freshness, { ...review, planningRisks: ["The ceremony runs into sunset"] }), false);
  assert.equal(reviewSettled(freshness, { ...review, contradictions: ["Two ceremony times"] }), false);
  assert.equal(reviewSettled(freshness, { ...review, missingInformation: ["Bridal prep start time", "Officiant's name"] }), false);
  // Written after the settling answer: it already knew; nothing to supersede.
  assert.equal(reviewSettled(freshness, { ...review, generatedAt: "2026-10-05T00:00:00.000Z" }), false);
});

test("a flag mentions a question only by its telling words, three letters or more", () => {
  assert.equal(flagMentions("Bridal preparation start and end times are unspecified", ["Bridal prep start time"]), true);
  assert.equal(flagMentions("Name of the officiant", ["Bridal prep start time"]), false);
  // "a", "of", "to" never match a word by its start.
  assert.equal(flagMentions("a photo of the address", ["Officiant address"]), false);
});

test("wired: re-runs a review a later form settled, never reopening what a person decided", () => {
  const sync = read("functions/src/planning/job-answers-sync.ts");
  assert.match(sync, /rerunReason: "settled_on_a_later_form"/);
  assert.match(sync, /String\(job\.get\("rerunFor"\) \?\? ""\) >= newestSettling/);
  assert.match(sync, /!reviewSettled\(freshness, review\)/);
  const worker = read("functions/src/operations/ai-pdf.ts");
  assert.match(worker, /if\(reviewOpen\)batch\.set\(db\.doc\(`aiActions\/\$\{actionId\}`\)/);
  assert.match(worker, /if\(followupOpen&&somethingToAsk&&followupBody/);
  assert.match(worker, /supersededReason:"nothing_left_to_ask"/);
  const trigger = read("functions/src/planning/crew-brief-trigger.ts");
  assert.match(trigger, /if \(!sentBack\(event\.data\?\.before\?\.data\(\)\) && !sentBack\(after\)\) return;/);
  // Cue reads the raw forms: `compact` dropped the answers.
  assert.match(read("functions/src/ai/copilot.ts"), /collection\("questionnaireResponses"\)\s*\.where\("tenantId", "==", tenantId\)\s*\.where\("projectId", "==", projectId\)/);
  // Contradictions and risks are never hidden on the card.
  assert.match(read("components/planning/questionnaire-review-insights.tsx"), /contradictions: strings\(review\.contradictions\),\s*planningRisks: strings\(review\.planningRisks\),/);
});
