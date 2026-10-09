import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eventDetailCategory } from "@/features/contracts/event-details";
import { projectJourney, type JourneyInput } from "@/features/journey/steps";
import { renderLifecycleDraft } from "@/features/messaging/render";
import { lockingFieldIds } from "@/features/planning/details-lock";
import { inquiryFormChoices, suggestedInquiryForm } from "@/features/questionnaires/inquiry-form-setting";
import {
  ONE_FORM_TRADES,
  recommendedFor,
  recommendedLibraryFor,
  type RecommendedQuestionnaire,
} from "@/features/questionnaires/recommended-templates";
import { questionnaireFieldSchema } from "@/features/questionnaires/schema";
import { templateLinkProblems } from "@/features/questionnaires/template-rules";
import { planChairs } from "@/features/schedules/chair-plan";
import { finalHeadcountState } from "@/features/schedules/final-headcount";
import { planNight } from "@/features/schedules/night-plan";
import { headcountNames, parsePartyList } from "@/features/schedules/party-list";
import { TRADES, tradeProfile } from "@/features/trades/trades";
import { renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { renderLifecycleDraft as renderServerLifecycleDraft } from "../functions/src/communications/lifecycle-core.ts";
import { finalDetailsHash, partyPeople } from "../functions/src/planning/final-details.ts";
import {
  recommendedFor as functionsRecommendedFor,
  recommendedLibraryFor as functionsRecommendedLibraryFor,
} from "../functions/src/planning/recommended-templates.ts";
import { assertStudioMayRecordAnswer, publishedApprovalState } from "../functions/src/planning/schedule-lifecycle.ts";
import { buildClientPortalExperience } from "../server/client/portal-experience.ts";
import { headcountHash } from "../server/planning/final-details.ts";

/**
 * Simpler vendor journeys, Phase 2 (Conor, 2026-10-09): a DJ's, makeup
 * artist's or hair stylist's client fills in one form, has nothing to approve,
 * and confirms the final headcount (makeup, hair) in one tap. A photographer's
 * journey does not change at all — every assertion about one is here too.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const VENDORS = ["dj", "makeup", "hair"] as const;
const OWN_FORM = { dj: "dj-music-planner", makeup: "makeup-party-list", hair: "hair-party-list" } as const;
const fields = (form: RecommendedQuestionnaire) => form.sections.flatMap((section) => section.fields);
const brand = { studioName: "Glow Studio", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };

// ── One form ────────────────────────────────────────────────────────────

test("a vendor starts with its own form alone; a photographer with the same three as before", () => {
  for (const trade of VENDORS) assert.deepEqual(recommendedFor(trade).map((form) => form.id), [OWN_FORM[trade]], trade);
  assert.deepEqual(recommendedFor("photographer").map((form) => form.id), ["wedding-event-details", "wedding-final-schedule", "wedding-shot-list"]);
  // The photographer's forms are exactly the library's, untouched.
  assert.deepEqual(recommendedFor("photographer"), recommendedLibraryFor("photographer"));
  // The server seeds what the app shows, for every trade.
  for (const trade of TRADES) {
    assert.deepEqual(functionsRecommendedFor(trade), recommendedFor(trade), trade);
    assert.deepEqual(functionsRecommendedLibraryFor(trade), recommendedLibraryFor(trade), trade);
  }
  // Onboarding seeds `recommendedFor` and names the trade's own form as the planning form.
  const onboarding = read("functions/src/saas/onboarding.ts");
  assert.match(onboarding, /const recommended = recommendedFor\(trade\.trade\);/);
  assert.match(onboarding, /preloaded\["dj-music-planner"\] \?\? preloaded\["makeup-party-list"\] \?\? preloaded\["hair-party-list"\]/);
});

test("the one-form trades are the trade profiles' own", () => {
  for (const trade of TRADES) assert.equal(ONE_FORM_TRADES.includes(trade), tradeProfile(trade).journey.oneForm, trade);
});

test("the event details form stays in a vendor's library to copy, without the camera questions", () => {
  for (const trade of VENDORS) {
    const library = recommendedLibraryFor(trade);
    assert.deepEqual(library.map((form) => form.id), ["wedding-event-details", OWN_FORM[trade]], trade);
    const details = library[0]!;
    assert.ok(!details.sections.some((section) => section.id === "coverage"));
    assert.match(details.useIt, /^Optional/);
  }
  // The library card is the one that offers it.
  assert.match(read("components/planning/recommended-questionnaires.tsx"), /recommendedLibraryFor\(tradeOf\(workspace\.tenantTrade\)\)/);
});

test("each one form is a valid template that holds together", () => {
  for (const trade of VENDORS) {
    const form = recommendedFor(trade)[0]!;
    const ids = fields(form).map((field) => field.id);
    assert.equal(new Set(ids).size, ids.length, `${trade}: ids are unique`);
    for (const field of fields(form)) questionnaireFieldSchema.parse(field);
    assert.deepEqual(templateLinkProblems(form.sections), [], trade);
  }
});

test("a DJ's planner asks where and when in the event details form's own words, and the night is laid out from it alone", () => {
  const planner = recommendedFor("dj")[0]!;
  assert.equal(planner.sections[0]!.id, "where-and-when");
  const details = recommendedLibraryFor("dj")[0]!;
  const byId = new Map(fields(details).map((field) => [field.id, field]));
  for (const field of planner.sections[0]!.fields) {
    assert.equal(field.label, byId.get(field.id)?.label, `${field.id} reads as the event details form does`);
    assert.equal(field.type, byId.get(field.id)?.type);
    assert.notEqual(field.allowTbd, true, "the planner settles them");
  }
  assert.deepEqual(
    planner.sections[0]!.fields.map((field) => [field.id, field.required]),
    [
      ["ceremony-location", false],
      ["ceremony-time", false],
      ["reception-location", true],
      ["reception-time", true],
      ["reception-end-time", true],
    ],
  );
  // The planner's answers, and nothing else, lay out the night.
  const night = planNight({
    answers: { "reception-location": "Hollow Oak", "reception-time": "18:00", "reception-end-time": "23:00", "ceremony-time": "16:30" },
  });
  assert.ok(night.rows.length > 5);
  assert.equal(night.coverageEnd, "23:00", "the music stops when they said");
  assert.equal(night.rows.find((row) => row.title === "Grand entrance")?.where, "Hollow Oak");
  assert.match(planNight({ answers: {} }).notes[0]!, /from their planner/);
});

test("a makeup or hair party list asks for a day-of contact, which never locks", () => {
  for (const trade of ["makeup", "hair"] as const) {
    const form = recommendedFor(trade)[0]!;
    const morning = form.sections.find((section) => section.id === "the-morning")!;
    const contact = morning.fields.find((field) => field.id === "day-of-contact");
    assert.ok(contact, trade);
    assert.equal(contact!.required, false);
    assert.equal(eventDetailCategory(contact!.label, trade), "contacts");
    assert.ok(!lockingFieldIds(form.sections).has("day-of-contact"));
    // Still what the chair schedule reads, in the same order.
    assert.deepEqual(form.sections.map((section) => section.id).slice(0, 2), ["the-morning", "your-party"]);
  }
});

test("a vendor's own form is never suggested as the inquiry form; a photographer's suggestion is unchanged", () => {
  const vendor = inquiryFormChoices([{ id: "t1", status: "active", name: "Party list", eventTypeId: "wedding", recommendedId: "makeup-party-list" }]);
  assert.equal(suggestedInquiryForm(vendor), "");
  const photographer = inquiryFormChoices([
    { id: "a", status: "active", name: "Final schedule", eventTypeId: "wedding", recommendedId: "wedding-final-schedule" },
    { id: "b", status: "active", name: "Event details form", eventTypeId: "wedding", recommendedId: "wedding-event-details" },
  ]);
  assert.equal(suggestedInquiryForm(photographer), "b");
  // A photographer with only after-booking forms still opens on one, as before.
  assert.equal(
    suggestedInquiryForm(inquiryFormChoices([{ id: "a", status: "active", name: "Final schedule", eventTypeId: "wedding", recommendedId: "wedding-final-schedule" }])),
    "a",
  );
});

test("the form request says it's the one form for a vendor, and reads as before for a photographer", () => {
  const request = (trade?: string) =>
    renderEmailTemplate({ key: "questionnaire_request", brand, recipientName: "Maya", values: { trade, actionUrl: "https://studio-cue.com/q" } }).text;
  assert.match(request("makeup"), /the one form we need from you: we build your getting-ready schedule from it/);
  assert.match(request("dj"), /we build your run of show & MC script from it/);
  assert.doesNotMatch(request(undefined), /one form/);
  assert.doesNotMatch(request("photographer"), /one form/);
});

// ── Nothing extra to approve ────────────────────────────────────────────

test("a vendor's plan is published to read; a photographer's still asks the couple", () => {
  assert.equal(publishedApprovalState(undefined), "client_pending");
  assert.equal(publishedApprovalState("photographer"), "client_pending");
  for (const trade of VENDORS) assert.equal(publishedApprovalState(trade), "none", trade);
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /const approvalState = publishedApprovalState\(scheduleTenant\.get\("trade"\)\);/);
  assert.match(commands, /verifiedAt: now,\s*\},\s*approvalState,\s*publishedAt: now,/);
  // Nobody records an answer to a plan nobody was asked about.
  assert.throws(() => assertStudioMayRecordAnswer({ status: "published", approvalState: "none" }), /SCHEDULE_NOT_IN_REVIEW/);
  assert.doesNotThrow(() => assertStudioMayRecordAnswer({ status: "published", approvalState: "client_pending" }));
});

test("the client's portal asks nothing of a plan published to read", () => {
  const experience = (approvalState: string) =>
    buildClientPortalExperience({
      state: "PLANNING",
      availability: { schedule: true },
      checkpoints: [],
      currentSchedule: { status: "published", version: 1, approvalState },
    });
  assert.notEqual(experience("none").nextClientAction.name, "Approve your event-day schedule");
  assert.equal(experience("client_pending").nextClientAction.name, "Approve your event-day schedule");
  const schedule = read("components/client/kit/client-schedule.tsx");
  assert.match(schedule, /const actionable = awaiting && items\.length > 0 && !behind && !readOnlyTrade;/);
  assert.match(schedule, /approval === "none" \|\| \(readOnlyTrade && approval === "client_pending"\)/);
  assert.match(schedule, /Here’s the plan for your \$\{dayWord\}/);
});

test("the schedule email is a here's-the-plan note for a vendor, and unchanged for a photographer", () => {
  const email = (key: "schedule_review" | "final_schedule_published", trade?: string) =>
    renderEmailTemplate({ key, brand, recipientName: "Maya", projectName: "Maya & Sam", values: { trade, scheduleUrl: "https://studio-cue.com/client/schedule" } });
  const makeup = email("schedule_review", "makeup");
  assert.equal(makeup.subject, "Here's the plan for your morning — Glow Studio");
  assert.match(makeup.text, /getting-ready schedule for Maya & Sam from what you told us\. There's nothing you need to do\./);
  const dj = email("schedule_review", "dj");
  assert.equal(dj.subject, "Here's the plan for your night — Glow Studio");
  assert.match(dj.text, /run of show & MC script/);
  for (const trade of VENDORS) {
    assert.doesNotMatch(email("schedule_review", trade).text, /approv|photo/i, trade);
    assert.doesNotMatch(email("final_schedule_published", trade).text, /photo/i, trade);
  }
  const photo = email("schedule_review");
  assert.equal(photo.subject, "Your event-day schedule — Glow Studio");
  assert.match(photo.text, /We've shared your event-day schedule for Maya & Sam\./);
  assert.equal(email("final_schedule_published").subject, "Final schedule published — Glow Studio");
});

test("a month out, a vendor's client hears about the plan without being asked to check it, from both drafters", () => {
  const facts = {
    studioName: "Glow Studio",
    clientFirstName: "Maya",
    projectName: "Maya & Sam",
    eventDate: "2026-11-20",
    venueName: null,
    packageTotalCents: null,
    retainerPaidCents: null,
    balanceDueCents: null,
    scheduleUrl: "https://studio-cue.com/client/schedule",
    eventKind: "wedding",
    recipientEmail: "maya@example.com",
    recipientName: "Maya",
  };
  for (const render of [renderLifecycleDraft, renderServerLifecycleDraft]) {
    const makeup = render("schedule_confirmation", { ...facts, trade: "makeup" });
    assert.equal(makeup.subject, "Your getting-ready schedule for Maya & Sam");
    assert.match(makeup.body, /there's nothing you need to do/);
    assert.doesNotMatch(makeup.body, /double-check/);
    const photo = render("schedule_confirmation", facts);
    assert.equal(photo.subject, "Confirming your Maya & Sam timeline");
    assert.match(photo.body, /double-check every time/);
  }
});

// ── The plan drawn from the form ────────────────────────────────────────

test("the party list lays out the morning, and the editor drafts it from the one form without being asked", () => {
  const people = parsePartyList("Maya Brooks — bride — makeup\nJess Lee — bridesmaid — makeup\nAva — flower girl — hair", "makeup");
  const plan = planChairs({ people, service: "makeup", readyBy: "12:00", earliestStart: "08:00" });
  assert.equal(plan.slots.length, 2, "only those having makeup");
  assert.equal(plan.fits, true);
  const editor = read("components/planning/ai-schedule-generator.tsx");
  assert.match(editor, /const oneForm = tradeProfile\(workspace\.tenantTrade\)\.journey\.oneForm;/);
  assert.match(editor, /if \(!oneForm \|\| !weddingDay \|\| !projectId \|\| !eventDay\) return;/);
  assert.match(editor, /if \(draft \|\| selectedSchedule \|\| !selectedQuestionnaire\) return;/);
  assert.match(editor, /laidOutFromForm\.current = projectId;\s*setDrawnFromForm\(true\);\s*layOutDay\(\);/);
  // The day-plan test still finds the one way to build a wedding's day.
  assert.match(editor, /function layOutDay\(\) \{/);
});

// ── The final headcount in one tap ──────────────────────────────────────

test("the functions copy of the party list reader is identical", () => {
  assert.equal(read("functions/src/planning/party-list.ts"), read("features/schedules/party-list.ts"));
});

test("the headcount counts those having the studio's own service, from the newest party list", () => {
  const list = "Maya Brooks — bride — hair and makeup\nJess Lee — bridesmaid — makeup\nAva — flower girl — hair\nRose — mother — both";
  assert.deepEqual(headcountNames(list, "makeup"), ["Maya Brooks", "Jess Lee", "Rose"]);
  assert.deepEqual(headcountNames(list, "hair"), ["Maya Brooks", "Ava", "Rose"]);
  assert.deepEqual(partyPeople(["Old — bride", null, list], "hair"), ["Maya Brooks", "Ava", "Rose"], "the newest answer wins");
  assert.deepEqual(partyPeople([], "makeup"), []);
});

test("the lock opens a one-tap headcount for makeup and hair, with no call; a DJ and a photographer keep their call", () => {
  const source = read("functions/src/planning/final-details.ts");
  assert.match(source, /const headcount = tradeProfile\(trade\)\.perPersonPricing \? \(snapshot\.people \?\? \[\]\)\.length : null;/);
  assert.match(source, /headcount !== null\s*\? null\s*: await finalCallLink\(/);
  assert.match(source, /\.\.\.\(headcount !== null \? \{ kind: "headcount", headcount \} : \{\}\),/);
  assert.match(source, /finalCallUrl: call\?\.bookingUrl \?\? null,/);
  for (const trade of TRADES) assert.equal(tradeProfile(trade).perPersonPricing, trade === "makeup" || trade === "hair", trade);
});

test("the hash a photographer's couple confirms is unchanged; a party list's names are part of what is confirmed", () => {
  const snapshot = { rows: [{ label: "Ceremony", value: "St Paul's" }], timeline: [], responseIds: [], scheduleId: null, scheduleVersion: null };
  const before = createHash("sha256").update(JSON.stringify({ rows: snapshot.rows, timeline: snapshot.timeline })).digest("hex");
  assert.equal(finalDetailsHash(snapshot), before);
  assert.notEqual(finalDetailsHash({ ...snapshot, people: ["Maya"] }), before);
  // The client confirms the names they were shown: one added since changes it.
  assert.equal(headcountHash("abc", ["Maya", "Jess"]), headcountHash("abc", ["Maya", "Jess"]));
  assert.notEqual(headcountHash("abc", ["Maya", "Jess"]), headcountHash("abc", ["Maya", "Jess", "Ava"]));
});

test("the final details email asks makeup and hair 'still N?' with one tap, and nothing changes for a DJ or a photographer", () => {
  const values = (trade: string | undefined, extra: Record<string, unknown> = {}) => ({
    trade,
    eventKind: "wedding",
    finalCallUrl: "https://studio-cue.com/schedule/consultation?token=x",
    portalUrl: "https://studio-cue.com/client?final-details=1",
    ...extra,
  });
  const render = (trade: string | undefined, extra?: Record<string, unknown>) =>
    renderEmailTemplate({ key: "final_details_request", brand, recipientName: "Maya", projectName: "Maya & Sam", values: values(trade, extra) });
  const makeup = render("makeup", { headcount: 6 });
  assert.equal(makeup.subject, "Still 6 getting ready? Please confirm with Glow Studio");
  assert.match(makeup.text, /Still 6 people getting ready\?/);
  assert.match(makeup.text, /Yes, still 6 — confirm: https:\/\/studio-cue\.com\/client\?final-details=1/);
  assert.match(makeup.text, /people can be added but not taken off/);
  for (const trade of ["makeup", "hair"]) assert.doesNotMatch(render(trade, { headcount: 3 }).text, /call|photo/i, trade);
  assert.match(render("hair").subject, /^Who's getting ready\?/);
  // A DJ keeps the final planning call; a photographer's reads as it always did.
  assert.match(render("dj").text, /Book your final planning call/);
  const photo = render(undefined);
  assert.equal(photo.subject, "Please confirm your final details with Glow Studio");
  assert.match(photo.text, /Book your final details call/);
});

test("a confirmed headcount is the journey's Final headcount, Confirmed", () => {
  const project = { eventKind: "wedding", eventDate: "2026-10-20" };
  const timeline = { lockDaysBefore: 30 };
  assert.deepEqual(finalHeadcountState({ project, planningTimeline: timeline, signoff: null, today: "2026-09-01" }), { state: "not_yet", lockOn: "2026-09-20", startsAt: null });
  assert.equal(finalHeadcountState({ project, planningTimeline: timeline, signoff: null, today: "2026-09-20" })?.state, "invited");
  assert.equal(finalHeadcountState({ project, planningTimeline: timeline, signoff: { status: "awaiting_couple" }, today: "2026-09-21" })?.state, "invited");
  assert.equal(finalHeadcountState({ project, planningTimeline: timeline, signoff: { status: "confirmed" }, today: "2026-09-22" })?.state, "held");
  // Not gated on the studio's final call setting: there is no call.
  assert.equal(finalHeadcountState({ project, planningTimeline: { ...timeline, finalCall: false }, signoff: { status: "confirmed" }, today: "2026-09-22" })?.state, "held");
  // A job with no lock has no step.
  assert.equal(finalHeadcountState({ project: { eventKind: "family", eventDate: "2026-10-20" }, planningTimeline: timeline, signoff: null, today: "2026-09-22" }), null);

  const base: JourneyInput = {
    projectId: "p1",
    state: "PLANNING",
    eventDate: "2026-10-20",
    today: "2026-09-22",
    lead: null,
    hasConsultation: false,
    proposalStatus: "accepted",
    contractStatus: "completed",
    retainerInvoiceStatus: "paid",
    finalInvoiceStatus: null,
    questionnaireStatus: "submitted",
    questionnaireHasAnswers: true,
    scheduleStatus: "published",
    scheduleApprovalState: "none",
    scheduleHasUsableItems: true,
    crewAccepted: 0,
    crewRequired: 0,
    crewCascadeActive: false,
    coiStatus: null,
    insuranceRequired: "not_required",
    dayBeforeDraftStatus: null,
    hasDelivery: false,
    albumOrReviewDone: false,
  };
  const confirmed = projectJourney({
    ...base,
    trade: "makeup",
    finalCall: finalHeadcountState({ project, planningTimeline: timeline, signoff: { status: "confirmed" }, today: "2026-09-22" }),
  }).steps.find((step) => step.key === "final_call");
  assert.equal(confirmed?.title, "Final headcount");
  assert.equal(confirmed?.detail, "Confirmed");
  assert.equal(confirmed?.status, "complete");
  // The studio's journey reads the sign-off for makeup and hair, the call for everyone else.
  const hook = read("components/projects/use-project-journey.ts");
  assert.match(hook, /finalCall: tradeProfile\(tenantTrade\)\.perPersonPricing\s*\? finalHeadcountState\(/);
  assert.match(hook, /signoff: forProject\(detailSignoffs\.records\)\[0\] \?\? null,/);
});

test("the client confirms in one tap, with no typed name, and the server records who and which names", () => {
  const card = read("components/client/kit/client-final-details.tsx");
  assert.match(card, /if \(details\.kind === "headcount"\)/);
  assert.match(card, /confirmFinalDetailsRequest\(workspace\.tenantId, workspace\.projectId, "", details\.snapshotHash\)/);
  assert.match(card, /href="\/client\/questionnaire"/);
  const server = read("server/planning/final-details.ts");
  assert.match(server, /if \(!headcount && typedName\.length < 2\) throw new Error\("FINAL_DETAILS_NAME_REQUIRED"\);/);
  assert.match(server, /if \(headcountHash\(text\(data\.snapshotHash\), people\) !== input\.snapshotHash\) throw new Error\("FINAL_DETAILS_CHANGED"\);/);
  // Never below the count at the lock.
  assert.match(server, /const confirmedHeadcount = Math\.max\(people\.length, count\(data\.headcount\) \?\? 0\);/);
});

// ── The backfill ────────────────────────────────────────────────────────

test("the vendor forms backfill is dry by default, names its studios, and never touches a photographer", () => {
  const script = read("scripts/backfill-vendor-forms.mts");
  assert.match(script, /const apply = args\.includes\("--apply"\);/);
  assert.match(script, /if \(!tenantIds\.length\) \{\s*console\.error\("usage:/);
  assert.match(script, /if \(!trade\.journey\.oneForm\) \{/);
  assert.match(script, /"planningTimeline\.formTemplateId": planningFormId,/);
  assert.match(script, /status: "archived",/);
  assert.match(script, /if \(!apply\) \{\s*console\.log\("DRY RUN — pass --apply to write\."\);\s*return;/);
});
