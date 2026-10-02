import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applyCoupleAnswers,
  coupleCompletionPercent,
  coupleFormSections,
  coupleVisibleAnswers,
  inquiryDetailsPrefill,
  inquiryEventKind,
  inquiryFormOwed,
  inquiryFormResponseId,
  inquiryFormState,
  inquiryGetsEventForm,
  jobHasConsultation,
  queueInquiryFormAnalysis,
  questionnaireAnalysisJobId,
  resolveInquiryFormTemplate,
} from "../functions/src/intake/inquiry-form.ts";
import { jobFactSheet, prefillFromFacts } from "../functions/src/planning/job-facts.ts";
import { currentInquiryFormTemplate } from "@/features/questionnaires/inquiry-form-setting";
import { currentQuestionnaire } from "@/features/questionnaires/studio-edit";
import { buildClientMilestones, buildClientPortalExperience } from "@/server/client/portal-experience";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { errorCodeHasCopy } from "@/lib/ai/friendly-error";

/**
 * The studio's event form on the couple's inquiry page.
 *
 * GR Productions, 2026-10-01: "They should get the wedding info form right
 * away after wedding inquiry … Studio needs info from that for the meeting.
 * And for the contract." The form now sits on the /i/<token> page the couple
 * already gets with the first reply, before they pick a consultation time,
 * and the answers are an ordinary questionnaireResponses record on the job.
 */

const read = (path: string) => readFileSync(path, "utf8");

/* ── Which inquiries get the form ─────────────────────────────────────── */

test("a wedding inquiry gets the form; the couple's own label decides over the studio default", () => {
  assert.equal(inquiryEventKind({ eventTypeId: "wedding", eventTypeLabel: "Wedding" }), "wedding");
  assert.equal(inquiryEventKind({ eventTypeId: "wedding", eventTypeLabel: "Elopement" }), "wedding");
  assert.equal(inquiryEventKind({ eventTypeId: "wedding", eventTypeLabel: null }), "wedding");
  assert.equal(inquiryEventKind({ eventTypeId: null, eventTypeLabel: undefined }), "wedding");
  // eventTypeId on a lead is the tenant default, whatever they asked for.
  assert.equal(inquiryEventKind({ eventTypeId: "wedding", eventTypeLabel: "Engagement" }), "engagement");
  assert.equal(inquiryEventKind({ eventTypeId: "corporate", eventTypeLabel: "" }), "corporate");

  assert.equal(inquiryGetsEventForm({ eventTypeId: "wedding", eventTypeLabel: "Wedding" }), true);
  assert.equal(inquiryGetsEventForm({ eventTypeId: "wedding", eventTypeLabel: "Corporate" }), false);
  assert.equal(inquiryGetsEventForm({ eventTypeId: "wedding", eventTypeLabel: "Portrait" }), false);
  // One rule, so another kind is a list entry away.
  assert.equal(inquiryGetsEventForm({ eventTypeLabel: "Engagement" }, ["wedding", "engagement"]), true);
});

/* ── The chosen template, as it stands ────────────────────────────────── */

const templates = [
  { id: "v1", name: "Wedding event form", status: "archived", archivedAt: "2026-09-01" },
  { id: "v2", name: "Wedding event form", status: "archived", archivedAt: "2026-09-10", supersedesTemplateId: "v1" },
  { id: "v3", name: "Wedding event form", status: "active", archivedAt: null, supersedesTemplateId: "v2" },
  { id: "other", name: "Corporate brief", status: "active", archivedAt: null },
  { id: "gone", name: "Old form", status: "archived", archivedAt: "2026-01-01" },
];

test("editing the chosen form keeps the setting: the saved id is followed to the live version", () => {
  assert.equal(resolveInquiryFormTemplate(templates, "v1")?.id, "v3");
  assert.equal(resolveInquiryFormTemplate(templates, "v3")?.id, "v3");
  assert.equal(resolveInquiryFormTemplate(templates, "other")?.id, "other");
  // Archived with nothing after it: the form is off.
  assert.equal(resolveInquiryFormTemplate(templates, "gone"), null);
  assert.equal(resolveInquiryFormTemplate(templates, "missing"), null);
  // A loop can't hang it.
  const looped = [
    { id: "a", status: "archived", supersedesTemplateId: "b" },
    { id: "b", status: "archived", supersedesTemplateId: "a" },
  ];
  assert.equal(resolveInquiryFormTemplate(looped, "a"), null);
});

test("the studio's settings screen resolves the same template the server does", () => {
  for (const id of ["v1", "v2", "v3", "other", "gone", "missing"]) {
    assert.equal(currentInquiryFormTemplate(templates, id)?.id ?? null, resolveInquiryFormTemplate(templates, id)?.id ?? null, id);
  }
  assert.equal(currentInquiryFormTemplate(templates, null), null);
});

/* ── What the couple sees ──────────────────────────────────────────────── */

const templateSections = [
  {
    id: "day",
    title: "Your day",
    fields: [
      { id: "intro", label: "A few questions so we can plan your call.", type: "information", required: true, locked: false, internalOnly: false, options: [], conditionalOn: null },
      { id: "date", label: "Wedding date", type: "date", required: true, locked: false, internalOnly: false, options: [], conditionalOn: null },
      { id: "venue", label: "Venue", type: "text", required: true, locked: false, internalOnly: false, options: [], conditionalOn: null },
      { id: "style", label: "Style", type: "radio", required: false, locked: false, internalOnly: false, options: ["Classic", "Candid"], conditionalOn: null },
      { id: "firstLook", label: "First look?", type: "radio", required: true, locked: false, internalOnly: false, options: ["Yes", "No"], conditionalOn: null },
      { id: "firstLookTime", label: "First look time", type: "time", required: true, locked: false, internalOnly: false, options: [], conditionalOn: { fieldId: "firstLook", equals: "Yes" } },
      { id: "colours", label: "Colours", type: "multi_select", required: false, locked: false, internalOnly: false, options: ["Sage", "Gold"], conditionalOn: null },
      { id: "terms", label: "I understand the call is free", type: "acknowledgement", required: false, locked: false, internalOnly: false, options: [], conditionalOn: null },
      { id: "package", label: "Package", type: "text", required: false, locked: true, internalOnly: false, options: [], conditionalOn: null },
      { id: "inspo", label: "Inspiration photos", type: "file", required: true, locked: false, internalOnly: false, options: [], conditionalOn: null },
    ],
  },
  {
    id: "studio",
    title: "Studio notes",
    fields: [{ id: "lead-score", label: "Lead score", type: "text", required: true, locked: false, internalOnly: true, options: [], conditionalOn: null }],
  },
];

test("the couple sees no internal or file questions, and no section left empty by them", () => {
  const sections = coupleFormSections(templateSections);
  assert.deepEqual(sections.map((section) => section.id), ["day"]);
  const ids = sections[0]!.fields.map((field) => field.id);
  assert.ok(!ids.includes("lead-score"), "internal-only stays with the studio");
  assert.ok(!ids.includes("inspo"), "a file needs the signed-in portal");
  assert.ok(ids.includes("intro"), "information shows as text");
  assert.equal(sections[0]!.fields.find((field) => field.id === "intro")?.required, false, "information is never required");
  assert.deepEqual(sections[0]!.fields.find((field) => field.id === "style")?.options, ["Classic", "Candid"]);
  assert.deepEqual(sections[0]!.fields.find((field) => field.id === "firstLookTime")?.conditionalOn, { fieldId: "firstLook", equals: "Yes" });
});

test("answers sent back to the page are only the couple's questions", () => {
  const sections = coupleFormSections(templateSections);
  assert.deepEqual(coupleVisibleAnswers(sections, { venue: "Barn", "lead-score": "A+" }), { venue: "Barn" });
});

/* ── Saving and sending ────────────────────────────────────────────────── */

test("a save is checked against each question, merged, and never writes what the couple can't", () => {
  const sections = coupleFormSections(templateSections);
  const save = applyCoupleAnswers({
    sections,
    prior: { "lead-score": "A+", package: "Gold" },
    incoming: {
      venue: "The Barn",
      style: "Moody", // not an option
      colours: ["Sage", "Teal"], // one off-list
      terms: "yes", // not a boolean
      date: "June 12", // not a date
      package: "Platinum", // locked
      "lead-score": "F", // internal
      intro: "changed", // information
      inspo: { name: "x.pdf" }, // file
      invented: "x", // no such question
    },
  });
  assert.deepEqual(save.answers, { "lead-score": "A+", package: "Gold", venue: "The Barn" });
  assert.deepEqual(save.changed, ["venue"]);
});

test("required means visible and empty: a hidden conditional question isn't owed", () => {
  const sections = coupleFormSections(templateSections);
  const partial = applyCoupleAnswers({ sections, prior: {}, incoming: { date: "2027-06-12", venue: "Barn", firstLook: "No" } });
  assert.deepEqual(partial.missing, []);
  const yes = applyCoupleAnswers({ sections, prior: partial.answers, incoming: { firstLook: "Yes" } });
  assert.deepEqual(yes.missing, ["First look time"]);
  const done = applyCoupleAnswers({ sections, prior: yes.answers, incoming: { firstLookTime: "15:30:00" } });
  assert.deepEqual(done.missing, []);
  assert.equal(done.answers.firstLookTime, "15:30");
  // The file question is the studio's to chase, never something the page holds a submit on.
  assert.ok(!done.missing.includes("Inspiration photos"));
  assert.equal(coupleCompletionPercent(sections, done.answers), 100);
  assert.equal(coupleCompletionPercent(sections, {}), 0);
});

test("an empty value clears an answer", () => {
  const sections = coupleFormSections(templateSections);
  const save = applyCoupleAnswers({ sections, prior: { venue: "Barn" }, incoming: { venue: "" } });
  assert.equal(save.answers.venue, null);
  assert.deepEqual(save.missing, ["Wedding date", "Venue", "First look?"]);
});

test("one response per job and form, whatever retries or tabs do", () => {
  const id = inquiryFormResponseId("t1", "p1", "v3");
  assert.equal(id, inquiryFormResponseId("t1", "p1", "v3"));
  assert.notEqual(id, inquiryFormResponseId("t1", "p2", "v3"));
  assert.notEqual(id, inquiryFormResponseId("t2", "p1", "v3"));
  assert.notEqual(id, inquiryFormResponseId("t1", "p1", "other"));
  assert.match(id, /^questionnaire_response_[0-9a-f]{32}$/);
});

test("the time step waits for the form only while the couple still owes it", () => {
  assert.equal(inquiryFormOwed(null), false);
  for (const status of ["not_started", "in_progress", "reopened"]) assert.equal(inquiryFormOwed({ status }), true, status);
  for (const status of ["submitted", "locked"]) assert.equal(inquiryFormOwed({ status }), false, status);
});

test("the form starts from what the job knows (shared with Send the form)", () => {
  const sheet = jobFactSheet({
    projectId: "p1",
    project: { eventDate: "2027-06-12", venueName: "The Barn" },
    leadId: null,
    lead: null,
    contacts: [],
    vendors: [],
    schedule: null,
    responses: [],
  });
  const prefill = prefillFromFacts({ sheet, sections: templateSections });
  assert.deepEqual(prefill.answers, { date: "2027-06-12", venue: "The Barn" });
  assert.equal((prefill.answerProvenance.date as { sourceType: string }).sourceType, "project_fact");
});

test("the form doesn't ask again what the couple told the date step a moment ago", () => {
  // The shipped wedding template's own labels (features/questionnaires/starter-templates.ts).
  const wedding = [
    {
      id: "couple",
      fields: [
        { id: "partner-one", label: "First partner's full name", type: "text" },
        { id: "partner-two", label: "Second partner's full name", type: "text" },
        { id: "guest-count", label: "Expected guest count", type: "text" },
        { id: "first-look", label: "Guest count", type: "radio", options: ["Yes"] },
        { id: "secret", label: "Partner name", type: "text", internalOnly: true },
      ],
    },
  ];
  const fields: Record<string, unknown> = { firstName: "Priya", lastName: "Shah", partnerName: "Jordan Lee", estimatedGuestCount: 120 };
  const prefill = inquiryDetailsPrefill({ get: (field: string) => fields[field] }, wedding);
  assert.deepEqual(prefill.answers, { "partner-one": "Priya Shah", "partner-two": "Jordan Lee", "guest-count": "120" });
  assert.equal((prefill.answerProvenance["guest-count"] as { sourceType: string; verified: boolean }).sourceType, "client_answer");
  assert.equal((prefill.answerProvenance["guest-count"] as { verified: boolean }).verified, false, "the couple's word, not a verified fact");
  // Nothing known, nothing filled.
  assert.deepEqual(inquiryDetailsPrefill({ get: () => undefined }, wedding).answers, {});
  // A first name alone is not a full name.
  assert.deepEqual(inquiryDetailsPrefill({ get: (field: string) => ({ firstName: "Priya" })[field as "firstName"] }, wedding).answers, {});
  // The page starts from both, the job's facts winning.
  const source = read("functions/src/booking/public-scheduling.ts");
  assert.match(source, /answers: \{ \.\.\.fromInquiry\.answers, \.\.\.fromJob\.answers \}/);
  // The form goes with it, so its AI map (if the studio made one) is used.
  assert.equal((source.match(/startingAnswers\(project, context\.lead, templateSections, template\)/g) ?? []).length, 2, "load and first save");
});

/* ── Where the inquiry stands: inquiryFormState over a small double ───── */

type Row = Record<string, unknown>;
function fakeDb(seed: Record<string, Row>) {
  const snapshot = (path: string) => {
    const data = seed[path];
    return {
      id: path.split("/").pop() ?? "",
      exists: data !== undefined,
      get: (field: string) => data?.[field],
      data: () => data ?? {},
      ref: { path },
    };
  };
  const query = (name: string, filters: [string, unknown][]): unknown => ({
    where: (field: string, _op: string, value: unknown) => query(name, [...filters, [field, value]]),
    limit: () => query(name, filters),
    get: async () => ({
      docs: Object.entries(seed)
        .filter(([path]) => path.startsWith(`${name}/`) && path.split("/").length === 2)
        .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
        .map(([path]) => snapshot(path)),
    }),
  });
  return {
    doc: (path: string) => ({ get: async () => snapshot(path) }),
    collection: (name: string) => query(name, []),
  } as unknown as FirebaseFirestore.Firestore;
}

const lead = (data: Row) => ({ id: "lead1", exists: true, get: (field: string) => data[field] }) as unknown as FirebaseFirestore.DocumentSnapshot;
const project = (data: Row) => ({ id: "p1", exists: true, get: (field: string) => data[field] }) as unknown as FirebaseFirestore.DocumentSnapshot;

const studioSeed = (extra: Record<string, Row> = {}) => ({
  "leadCaptureSettings/t1": { tenantId: "t1", inquiryEventForm: { templateId: "v1", eventTypes: ["wedding"] } },
  ...Object.fromEntries(templates.map((template) => [`questionnaireTemplates/${template.id}`, { ...template, tenantId: "t1", sections: templateSections }])),
  "questionnaireTemplates/elsewhere": { tenantId: "t2", status: "active", name: "Wedding event form" },
  ...extra,
});

test("no setting, no form: the page is as it was", async () => {
  const db = fakeDb({ "leadCaptureSettings/t1": { tenantId: "t1" } });
  assert.equal(await inquiryFormState(db, { tenantId: "t1", lead: lead({ eventTypeLabel: "Wedding" }), project: null }), null);
});

test("a dateless wedding inquiry is asked for its date first — the date makes the job the answers belong to", async () => {
  const db = fakeDb(studioSeed());
  const state = await inquiryFormState(db, { tenantId: "t1", lead: lead({ eventTypeId: "wedding", eventTypeLabel: "Wedding" }), project: null });
  assert.equal(state?.requiresDate, true);
  assert.equal(state?.template.id, "v3", "the live version of the chosen form");
});

test("a dated inquiry with no job (held as maybe) gets no form: nothing to attach it to", async () => {
  const db = fakeDb(studioSeed());
  const state = await inquiryFormState(db, { tenantId: "t1", lead: lead({ eventDate: "2027-06-12", eventTypeLabel: "Wedding" }), project: null });
  assert.equal(state, null);
});

test("on a job: not a wedding means no form; a wedding gets it, reusing a copy the studio already sent", async () => {
  const corporate = await inquiryFormState(fakeDb(studioSeed()), {
    tenantId: "t1",
    lead: lead({}),
    project: project({ eventTypeId: "wedding", eventType: "Corporate" }),
  });
  assert.equal(corporate, null);

  const fresh = await inquiryFormState(fakeDb(studioSeed()), {
    tenantId: "t1",
    lead: lead({}),
    project: project({ eventTypeId: "wedding", eventType: "Wedding" }),
  });
  assert.equal(fresh?.response, null);
  assert.equal(fresh?.status, "not_started");

  const sent = await inquiryFormState(
    fakeDb(studioSeed({
      "questionnaireResponses/assigned": { tenantId: "t1", projectId: "p1", templateId: "v2", templateName: "Wedding event form", status: "in_progress" },
      "questionnaireResponses/foreign": { tenantId: "t2", projectId: "p1", templateId: "v3", status: "submitted" },
    })),
    { tenantId: "t1", lead: lead({}), project: project({ eventTypeId: "wedding", eventType: "Wedding" }) },
  );
  assert.equal(sent?.response?.id, "assigned", "the same form by name: no second copy");
  assert.equal(sent?.status, "in_progress");
});

test("a copy the studio withdrew is not the couple's to fill in", async () => {
  const state = await inquiryFormState(
    fakeDb(studioSeed({
      "questionnaireResponses/taken": { tenantId: "t1", projectId: "p1", templateId: "v3", templateName: "Wedding event form", status: "withdrawn" },
    })),
    { tenantId: "t1", lead: lead({}), project: project({ eventType: "Wedding" }) },
  );
  assert.equal(state, null);
});

/* ── The AI read waits for the call ───────────────────────────────────── */

/**
 * The analysis is charged to the studio's AI allowance, and the inquiry page
 * is public: a form from a couple who never books must not cost a run. It is
 * queued when the call is booked (or the proposal goes out), once.
 */
function writableDb(seed: Record<string, Row>) {
  const store: Record<string, Row> = { ...seed };
  const reads = fakeDb(store) as unknown as { collection: (name: string) => unknown };
  return {
    store,
    db: {
      collection: reads.collection,
      doc: (path: string) => ({
        create: async (data: Row) => {
          if (store[path]) throw Object.assign(new Error("6 ALREADY_EXISTS: Document already exists"), { code: 6 });
          store[path] = data;
        },
      }),
    } as unknown as FirebaseFirestore.Firestore,
  };
}

test("a sent inquiry-page form is analysed once the call is booked — once, however often that moment recurs", async () => {
  const { db, store } = writableDb({
    "questionnaireResponses/r1": { tenantId: "t1", projectId: "p1", source: "inquiry_page", status: "submitted", archivedAt: null },
    // Still being filled in: nothing to read yet.
    "questionnaireResponses/r2": { tenantId: "t1", projectId: "p1", source: "inquiry_page", status: "in_progress", archivedAt: null },
    // Sent from the job page: the portal submit queued its own.
    "questionnaireResponses/r3": { tenantId: "t1", projectId: "p1", source: "studio", status: "submitted", archivedAt: null },
    // Another studio's job of the same id.
    "questionnaireResponses/r4": { tenantId: "t2", projectId: "p1", source: "inquiry_page", status: "submitted", archivedAt: null },
  });
  const now = "2026-10-01T12:00:00.000Z";
  assert.deepEqual(await queueInquiryFormAnalysis(db, { tenantId: "t1", projectId: "p1", now }), ["r1"]);
  const job = store[`aiJobs/${questionnaireAnalysisJobId("r1")}`];
  assert.equal(job?.type, "questionnaire_analysis");
  assert.equal(job?.status, "queued");
  assert.equal(job?.tenantId, "t1");
  assert.equal(job?.responseId, "r1");
  assert.equal(job?.humanReviewRequired, true);
  assert.equal(job?.id, "questionnaire_r1", "the id the portal submit uses: one job per response");
  // The call moved, the proposal went out: never a second run.
  store[`aiJobs/${questionnaireAnalysisJobId("r1")}`] = { ...job, status: "succeeded" };
  assert.deepEqual(await queueInquiryFormAnalysis(db, { tenantId: "t1", projectId: "p1", now }), []);
  assert.equal(store[`aiJobs/${questionnaireAnalysisJobId("r1")}`]?.status, "succeeded", "a finished run is not re-queued");
  assert.equal(Object.keys(store).filter((path) => path.startsWith("aiJobs/")).length, 1);
});

test("queueing the read never fails the booking it rides on", async () => {
  const broken = {
    collection: () => {
      throw new Error("UNAVAILABLE");
    },
  } as unknown as FirebaseFirestore.Firestore;
  const original = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await queueInquiryFormAnalysis(broken, { tenantId: "t1", projectId: "p1", now: "x" }), []);
  } finally {
    console.error = original;
  }
});

test("a call that stands is booked or held; a cancelled, moved or missed one is not", async () => {
  const db = (status: string) => fakeDb({ "consultations/c1": { tenantId: "t1", projectId: "p1", status } });
  for (const status of ["scheduled", "completed"]) {
    assert.equal(await jobHasConsultation(db(status), { tenantId: "t1", projectId: "p1" }), true, status);
  }
  for (const status of ["cancelled", "rescheduled", "no_show"]) {
    assert.equal(await jobHasConsultation(db(status), { tenantId: "t1", projectId: "p1" }), false, status);
  }
  assert.equal(await jobHasConsultation(db("scheduled"), { tenantId: "t2", projectId: "p1" }), false, "another studio's call");
});

test("submit queues the read only when the call is already booked; booking queues it otherwise", () => {
  const source = read("functions/src/booking/public-scheduling.ts");
  const handler = source.slice(source.indexOf("async function handleInquiryForm("));
  assert.match(handler, /const analyseNow =\s*submit && \(pastTheCall\(context\) \|\| \(await jobHasConsultation\(/);
  assert.match(handler, /if \(submit && analyseNow\) \{\s*transaction\.set\(\s*db\.doc\(`aiJobs\/\$\{questionnaireAnalysisJobId\(responseId\)\}`\)/);
  assert.equal((handler.match(/questionnaire_analysis|aiJobs\//g) ?? []).length, 1, "the one guarded write");
  // inquiry_book: after the consultation is committed.
  const book = source.slice(source.indexOf("// inquiry_book"), source.indexOf("async function handleInquiryForm("));
  assert.match(book, /await batch\.commit\(\);\s*(\/\/[^\n]*\n\s*)*await queueInquiryFormAnalysis\(db, \{ tenantId: context\.tenantId, projectId: project\.id, now \}\)/);
  // A studio-sent scheduling link books a call too.
  assert.match(source, /await batch\.commit\(\);\s*(\/\/[^\n]*\n\s*)*await queueInquiryFormAnalysis\(db, \{\s*tenantId: String\(link\.get\("tenantId"\)\)/);
  // The studio booking the call, and a proposal with no call booked here.
  const commands = read("functions/src/booking/commands.ts");
  const schedule = commands.slice(
    commands.indexOf('command.type === "scheduleConsultation"'),
    commands.indexOf('command.type === "cancelConsultation"'),
  );
  assert.match(schedule, /await queueInquiryFormAnalysis\(firestore, \{\s*tenantId: command\.tenantId,\s*projectId: command\.input\.projectId/);
  const proposals = read("functions/src/booking/proposals.ts");
  assert.match(proposals, /if \(command\.type === "send" && result\.status === "sent"\) \{[\s\S]{0,300}await queueInquiryFormAnalysis\(db,/);
});

/* ── The couple's journey ──────────────────────────────────────────────── */

test("Event form sits between Inquiry received and Consultation, only when the job has one", () => {
  const plain = buildClientMilestones("LEAD");
  assert.deepEqual(plain.map((milestone) => milestone.id).slice(0, 2), ["inquiry", "consultation"]);

  const owed = buildClientMilestones("LEAD", { inquiryForm: { returned: false } });
  assert.deepEqual(owed.map((milestone) => milestone.id).slice(0, 3), ["inquiry", "event_form", "consultation"]);
  assert.equal(owed[1]!.label, "Event form");
  assert.equal(owed[1]!.status, "current");
  assert.equal(owed[2]!.status, "upcoming", "one current step at a time");
  assert.equal(owed.filter((milestone) => milestone.status === "current").length, 1);

  const done = buildClientMilestones("CONSULTATION", { inquiryForm: { returned: true } });
  assert.equal(done[1]!.status, "complete");
  assert.equal(done[2]!.status, "current");

  // Past the call without it: no step the couple can no longer take.
  const skipped = buildClientMilestones("BOOKED", { inquiryForm: { returned: false } });
  assert.ok(!skipped.some((milestone) => milestone.id === "event_form"));
  const kept = buildClientMilestones("BOOKED", { inquiryForm: { returned: true } });
  assert.equal(kept.find((milestone) => milestone.id === "event_form")?.status, "complete");

  const experience = buildClientPortalExperience({ state: "LEAD", availability: {}, checkpoints: [], inquiryForm: { returned: true } });
  assert.ok(experience.milestones.some((milestone) => milestone.id === "event_form"));
});

test("the portal route tells the journey about the inquiry-page form", () => {
  const route = read("app/api/client/portal/route.ts");
  assert.match(route, /document\.get\("source"\) === "inquiry_page"/);
  assert.match(route, /questionnaireStatus,\s*inquiryForm,/);
});

/* ── The studio's journey ──────────────────────────────────────────────── */

const journeyBase: JourneyInput = {
  projectId: "project-1",
  state: "BOOKED",
  eventDate: "2027-06-12",
  today: "2026-10-01",
  lead: { id: "lead-1", status: "converted" },
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "signed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: null,
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: null,
  scheduleHasUsableItems: false,
  crewAccepted: 0,
  crewCascadeActive: false,
  coiStatus: null,
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
};

test("the job's 'Wedding details form' step is done by a form sent from the inquiry page", () => {
  const responses = [
    { id: "inq", status: "submitted", source: "inquiry_page", answers: { venue: "Barn" }, archivedAt: null },
  ];
  const standing = currentQuestionnaire(responses);
  assert.equal(standing?.id, "inq");
  const { steps } = projectJourney({ ...journeyBase, questionnaireSource: standing?.source });
  const form = steps.find((step) => step.key === "schedule_form");
  assert.equal(form?.status, "complete");
  assert.equal(form?.detail, "The couple filled it in before the consultation");
  const portalSent = projectJourney(journeyBase).steps.find((step) => step.key === "schedule_form");
  assert.equal(portalSent?.detail, "Client completed it");
});

/* ── Wiring: the token is the only credential ─────────────────────────── */

test("the form actions are token-only, resolved through the inquiry link, and rate-limited", () => {
  const source = read("functions/src/booking/public-scheduling.ts");
  for (const type of ["inquiry_form", "inquiry_form_save"]) {
    assert.match(source, new RegExp(`type: z\\.literal\\("${type}"\\)`), type);
    assert.match(source, new RegExp(`command\\.type === "${type}"`), type);
  }
  const schema = source.slice(source.indexOf('z.literal("inquiry_form_save")'), source.indexOf('z.literal("inquiry_cancel")'));
  assert.doesNotMatch(schema, /tenantId|projectId/, "the browser never names the studio or the job");
  // Every inquiry_* command resolves the token before it is handled.
  assert.match(source, /const context = await resolveInquiryLink\(db, command\.input\.token\);\s*const result = await handleInquiryCommand/);
  const handler = source.slice(source.indexOf("async function handleInquiryForm("));
  assert.match(handler, /await limitInquiryFormSaves\(db, context\.lead\.id\)/);
  assert.match(handler, /throw new Error\("EVENT_DATE_REQUIRED"\)/);
  assert.match(handler, /throw new Error\("INQUIRY_FORM_INCOMPLETE"\)/);
  assert.match(handler, /throw new Error\("QUESTIONNAIRE_ALREADY_SUBMITTED"\)/);
  assert.match(handler, /source: INQUIRY_FORM_SOURCE/);
  assert.match(handler, /filled in your \$\{name\}/, "the studio hears about it");
  // The couple is on the page: no request email.
  assert.doesNotMatch(handler, /questionnaire_request|emailJobs/);
  // Response checked against the token's studio and job before any write.
  assert.match(handler, /snapshot\.get\("tenantId"\) !== context\.tenantId \|\| snapshot\.get\("projectId"\) !== project\.id/);
});

test("booking a new call waits for the form; moving one already booked does not", () => {
  const source = read("functions/src/booking/public-scheduling.ts");
  assert.match(
    source,
    /if \(!previous && inquiryFormOwed\(await inquiryFormState\(db, context\)\)\) \{\s*throw new Error\("INQUIRY_FORM_REQUIRED"\);/,
  );
});

test("the setting is written by an owner or admin, through the planning command", () => {
  const source = read("functions/src/planning/commands.ts");
  const branch = source.slice(source.indexOf('parsed.type === "setInquiryEventForm"'), source.indexOf('parsed.type === "saveTimingRule"'));
  assert.match(branch, /if \(!\["studio_owner", "studio_admin"\]\.includes\(role\)\)\s*throw new Error\("FORBIDDEN"\)/);
  assert.match(branch, /template\.get\("tenantId"\) !== parsed\.tenantId/);
  assert.match(branch, /INQUIRY_FORM_SETTINGS_PATH\(parsed\.tenantId\)/);
  assert.match(branch, /tenantId: parsed\.tenantId/);
  assert.match(branch, /auditEvents/);
});

test("the couple's page stays light: no Firebase import, the shared question renderer", () => {
  const page = read("components/inquiries/couple-inquiry-page.tsx");
  assert.doesNotMatch(page, /from "firebase\//);
  assert.match(page, /from "@\/components\/client\/kit\/questionnaire-question"/);
  assert.match(page, /"inquiry_form_save"/);
  const question = read("components/client/kit/questionnaire-question.tsx");
  assert.doesNotMatch(question, /firebase|useWorkspace/);
});

test("every new refusal reads as English", () => {
  for (const code of ["INQUIRY_FORM_REQUIRED", "INQUIRY_FORM_INCOMPLETE", "INQUIRY_FORM_NOT_AVAILABLE"]) {
    assert.equal(errorCodeHasCopy(code), true, code);
  }
});

test("the reply's link line doesn't promise two minutes when the form comes first", async () => {
  const { inquiryLinkLine } = await import("../functions/src/intake/inquiry-link");
  const url = "https://studio-cue.com/i/abc";
  assert.equal(inquiryLinkLine(url, true), `Tell us about your day and pick a time to talk: ${url}`);
  assert.match(inquiryLinkLine(url, false), /it takes two minutes: https:\/\/studio-cue\.com\/i\/abc$/);
});

test("a phone call needs a number: the one on file, else the one given", async () => {
  const { phoneForCall } = await import("../functions/src/booking/public-scheduling");
  assert.equal(phoneForCall("201-555-0123", undefined), "201-555-0123");
  assert.equal(phoneForCall("", " (201) 555 0144 "), "(201) 555 0144");
  assert.equal(phoneForCall("", "12345"), null);
  assert.equal(phoneForCall("", undefined), null);
  const server = readFileSync("functions/src/booking/public-scheduling.ts", "utf8");
  assert.match(server, /if \(command\.input\.format === "phone" && !phone\) throw new Error\("PHONE_NUMBER_REQUIRED"\);/);
  const page = readFileSync("components/inquiries/couple-inquiry-page.tsx", "utf8");
  assert.match(page, /const needsPhone = format === "phone" && Boolean\(preview\?\.missing\.includes\("phone"\)\);/);
});
