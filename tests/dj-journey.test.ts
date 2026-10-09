import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { eventDetailCategory, eventDetailsFrom } from "../features/contracts/event-details";
import { examplePackagesFor } from "../features/job-kinds/example-packages";
import { projectJourney, type JourneyInput } from "../features/journey/steps";
import { defaultInquiryFormFor } from "../features/leads/inquiry-form-config";
import { renderLifecycleDraft } from "../features/messaging/render";
import { coverageRoleForLabel, coverageTradeNamed } from "../features/crew/staffing-plan";
import { recommendedFor } from "../features/questionnaires/recommended-templates";
import { crewLabels, labelName } from "../features/schedules/crew-labels";
import { fillMcScript, mcScriptLine, patchMcScript } from "../features/schedules/mc-script";
import { planNight } from "../features/schedules/night-plan";
import { tradeProfile, tradeVocab } from "../features/trades/trades";
import { glossaryFor } from "../features/help/glossary";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";
import { renderLifecycleDraft as renderServerLifecycleDraft } from "../functions/src/communications/lifecycle-core";
import { tradeInstruction } from "../functions/src/trades/trade-instruction";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the functions copy of the MC script matches features/", () => {
  const body = (source: string) => source.slice(source.indexOf("/**"));
  assert.equal(body(read("functions/src/planning/mc-script.ts")), body(read("features/schedules/mc-script.ts")));
});

test("a DJ starts with the Music & moments planner, locked ten days out, sent at booking", () => {
  const dj = recommendedFor("dj").map((form) => form.id);
  assert.deepEqual(dj, ["wedding-event-details", "dj-music-planner"]);
  assert.deepEqual(recommendedFor("photographer").map((form) => form.id), ["wedding-event-details", "wedding-final-schedule", "wedding-shot-list"]);
  assert.deepEqual(tradeProfile("dj").planning, { formAtBooking: true, lockDaysBefore: 10 });
  assert.equal(tradeProfile("photographer").planning, null);
  const onboarding = read("functions/src/saas/onboarding.ts");
  assert.match(onboarding, /\.\.\.\(trade\.planning \?\? \{\}\)/);
  assert.match(onboarding, /preloaded\["dj-music-planner"\]/);
  // The settings screen keeps ten days rather than rounding to a week.
  assert.match(read("components/planning/planning-timeline-settings.tsx"), /const LOCK_DAY_CHOICES = \[7, 10, 14, 21, 28, 35, 42, 56\];/);
});

test("every planner answer the MC script reads is a question on the planner", () => {
  const planner = recommendedFor("dj").find((form) => form.id === "dj-music-planner")!;
  const ids = new Set(planner.sections.flatMap((section) => section.fields.map((field) => field.id)));
  const source = read("features/schedules/mc-script.ts");
  const keys = [...source.matchAll(/(?:song|announcement): "([a-z-]+)"/g)].map((match) => match[1]!);
  assert.ok(keys.length >= 10);
  for (const key of keys) assert.ok(ids.has(key), `${key} is read by the MC script but not asked on the planner`);
  // The names on the mic, with how to say them, are the one required answer.
  assert.equal(planner.sections.flatMap((section) => section.fields).find((field) => field.id === "entrance-names")?.required, true);
});

test("the MC script fills from the planner without touching what the DJ wrote", () => {
  const answers = {
    "grand-entrance-song": "Mr. Brightside",
    "entrance-names": "Maid of honor, Siobhan Murphy (shi-VAWN)",
    "first-dance-song": "At Last — Etta James",
    "parent-dance-songs": "Maya and her dad: My Girl",
    "toast-order": "Best man, Tadhg (TIEG)",
  };
  const { items, filled } = fillMcScript(
    [
      { title: "Grand entrance" },
      { title: "First dance" },
      { title: "Parent dances" },
      { title: "Toasts and speeches" },
      { title: "Cake cutting", mc: { song: "Sugar", announcement: null, pronunciation: null } },
      { title: "Dinner" },
    ],
    answers,
  );
  assert.equal(filled, 4);
  assert.deepEqual(items[0]!.mc, { song: "Mr. Brightside", announcement: "Maid of honor, Siobhan Murphy (shi-VAWN)", pronunciation: null });
  assert.equal(items[1]!.mc?.song, "At Last — Etta James");
  assert.equal(items[2]!.mc?.song, "Maya and her dad: My Girl", "parent dances, not the first dance");
  assert.equal(items[3]!.mc?.announcement, "Best man, Tadhg (TIEG)");
  assert.equal(items[4]!.mc?.song, "Sugar", "the DJ's own song stays");
  assert.equal(items[5]!.mc, undefined);
  assert.equal(mcScriptLine(items[0]!.mc), "♪ Mr. Brightside · Say: Maid of honor, Siobhan Murphy (shi-VAWN)");
  assert.equal(patchMcScript({ song: "x", announcement: null, pronunciation: null }, { song: "  " }), undefined);
});

test("the MC script reaches the PDF, the DJ's day sheet, the couple and the server", () => {
  assert.match(read("functions/src/operations/ai-pdf.ts"), /mcScriptLine\(item\.mc as Partial<McScript>\|undefined\)/);
  assert.match(read("components/crew/kit/crew-day-sheet.tsx"), /mcScriptLine\(item\.mc/);
  assert.match(read("components/client/kit/client-schedule.tsx"), /mcScriptLine\(item\.mc/);
  // zod drops keys it doesn't know: the server must name `mc`.
  assert.match(read("functions/src/planning/commands.ts"), /mc: z\s*\.object\(\{\s*song: z\.string\(\)\.max\(200\)\.nullable\(\)/);
  assert.match(read("features/schedules/schema.ts"), /mc: z\.object\(\{ song:/);
});

test("a DJ's night runs from the ceremony music to the send-off, anchored on their times", () => {
  const night = planNight({ answers: { "ceremony-time": "4:00 PM", "reception-time": "18:00", "coverageEndTime": "23:00" } });
  const titles = night.rows.map((row) => `${row.time} ${row.title}`);
  assert.deepEqual(titles.slice(0, 6), [
    "15:30 Guests arrive — prelude music",
    "16:00 Processional",
    "16:05 Ceremony",
    "16:25 Recessional",
    "16:30 Cocktail hour",
    "18:00 Grand entrance",
  ]);
  assert.equal(night.rows.at(-1)!.title, "Send-off");
  assert.equal(night.rows.at(-1)!.time, "22:50");
  assert.equal(night.rows.find((row) => row.title === "Grand entrance")!.source, "form");
  assert.equal(night.rows.find((row) => row.title === "First dance")!.source, "usual");
  // A night past midnight is held to the day; no times at all asks for them.
  const late = planNight({ answers: { "reception-time": "19:00", "coverageEndTime": "01:00" } });
  assert.ok(late.rows.every((row) => row.time < "24:00"));
  assert.equal(planNight({ answers: {} }).rows.length, 0);
  // The editor lays out a DJ's night, not a photographer's day.
  assert.match(read("components/planning/ai-schedule-generator.tsx"), /const plan = mcScript\s*\? planNight\(/);
});

test("DJs are a crew role: D1, D2, never ranked as photographers", () => {
  assert.equal(coverageRoleForLabel("Second DJ"), "dj");
  assert.equal(coverageRoleForLabel("MC"), "dj");
  assert.equal(coverageTradeNamed("DJ"), "dj");
  assert.equal(coverageRoleForLabel("Second shooter"), "photographer");
  const labels = crewLabels([
    { id: "a", role: "Lead DJ" },
    { id: "b", role: "DJ" },
    { id: "c", role: "Lead photographer" },
  ]);
  assert.deepEqual([labels.get("a")?.label, labels.get("b")?.label, labels.get("c")?.label], ["D1", "D2", "P1"]);
  assert.equal(labelName("D2"), "DJ 2");
  // A photographer's pickers never offer "DJ"; a DJ's offer only DJs.
  assert.deepEqual([...tradeProfile("photographer").coverageRoles], ["photographer", "videographer"]);
  assert.match(read("components/crew/trade-field.tsx"), /tradeRoles\.includes\(role\) \|\| selected\.has\(role\)/);
  // Cue staffs only the studio's own roles.
  assert.match(read("functions/src/ai/copilot.ts"), /namedTrade === null \|\| !staffedRoles\.includes\(namedTrade\)/);
});

test("a DJ's packages count DJs, with DJ examples", () => {
  const [reception] = examplePackagesFor("dj", "wedding");
  assert.equal(reception?.name, "Reception");
  assert.equal(examplePackagesFor("photographer", "wedding")[0]?.name, "Full-day wedding");
  assert.match(read("components/crm/create-package-form.tsx"), /includedCoverage: coverageFrom\(values, roles\)/);
  assert.match(read("components/crm/edit-package-form.tsx"), /tradeShape\.delivery \? \(\s*<PackageDeliverablesEditor/);
});

test("a DJ's agreement carries load-in and power, not getting ready", () => {
  assert.equal(eventDetailCategory("Load-in time"), "venue_logistics");
  assert.equal(eventDetailCategory("Load-in, parking and power at your venue"), "venue_logistics");
  assert.equal(eventDetailCategory("Ceremony time"), "times");
  const dj = eventDetailsFrom({ eventType: "Wedding", eventKind: "wedding", date: null, venue: "Hollow Oak", coverage: null, answers: [], trade: "dj" });
  assert.ok(!dj.missing.includes("Getting ready"));
  const photographer = eventDetailsFrom({ eventType: "Wedding", eventKind: "wedding", date: null, venue: "Hollow Oak", coverage: null, answers: [] });
  assert.ok(photographer.missing.includes("Getting ready"));
  assert.match(read("functions/src/contracts/sources.ts"), /trade: text\(tenant\.get\("trade"\)\) \|\| null,/);
});

test("a DJ's inquiry form asks for hours of music and the ceremony", () => {
  const dj = defaultInquiryFormFor("dj");
  assert.deepEqual(dj.eventTypes.map((type) => type.id), ["wedding", "corporate", "party", "general"]);
  assert.deepEqual(dj.questions.map((question) => question.id), ["music-hours", "ceremony-music"]);
  assert.equal(defaultInquiryFormFor("photographer").questions.length, 0);
  assert.match(read("functions/src/saas/onboarding.ts"), /trade\.trade !== "photographer" \? \{ inquiryForm: defaultInquiryFormFor\(trade\.trade\) \}/);
});

const base: JourneyInput = {
  projectId: "p1",
  state: "PLANNING",
  eventDate: "2026-10-20",
  today: "2026-10-19",
  lead: null,
  hasConsultation: true,
  proposalStatus: "accepted",
  contractStatus: "completed",
  retainerInvoiceStatus: "paid",
  finalInvoiceStatus: "paid",
  questionnaireStatus: "submitted",
  questionnaireHasAnswers: true,
  scheduleStatus: "approved",
  scheduleHasUsableItems: true,
  crewAccepted: 0,
  crewRequired: 0,
  crewCascadeActive: false,
  coiStatus: null,
  insuranceRequired: "unknown",
  dayBeforeDraftStatus: null,
  hasDelivery: false,
  albumOrReviewDone: false,
  finalCall: { state: "booked", lockOn: "2026-10-10", startsAt: "2026-10-13T19:00:00Z" },
};

test("a DJ's journey speaks DJ: vibe call, music planner, final planning call, their own checklist", () => {
  const titles = projectJourney({ ...base, trade: "dj" }).steps.map((step) => step.title);
  assert.ok(titles.includes("Vibe call"));
  assert.ok(titles.includes("Music & moments planner"));
  assert.ok(titles.includes("Final planning call"));
  // The day-before note is part of the night itself (simpler vendor
  // journeys): the day before, "The night" is the move, in DJ words.
  assert.ok(!titles.includes("Day-before checklist"));
  const night = projectJourney({ ...base, trade: "dj" }).steps.find((step) => step.key === "event_day");
  assert.equal(night?.title, "The night");
  assert.match(String(night?.detail), /song changes/);
  const photo = projectJourney(base).steps.map((step) => step.title);
  assert.ok(photo.includes("Consultation") && photo.includes("Final details call") && photo.includes("Wedding details form"));
  assert.ok(photo.includes("Day-before checklist") && photo.includes("Event day"));
});

const facts = {
  studioName: "Spin Theory",
  clientFirstName: "Maya",
  projectName: "Maya & Sam",
  eventDate: "2026-10-20",
  venueName: "Hollow Oak",
  packageTotalCents: null,
  retainerPaidCents: null,
  balanceDueCents: null,
  scheduleUrl: null,
  recipientEmail: null,
  recipientName: null,
};

test("a DJ's couple gets a DJ's day-before checklist, from both drafters", () => {
  for (const render of [renderLifecycleDraft, renderServerLifecycleDraft]) {
    const dj = render("day_before_checklist", { ...facts, trade: "dj" });
    assert.match(dj.body, /last song changes/i);
    assert.doesNotMatch(dj.body, /dress/i);
    const photo = render("day_before_checklist", facts);
    assert.match(photo.body, /Dress on its special hanger/);
  }
  const reminder = renderEmailTemplate({
    key: "event_reminder",
    brand: { studioName: "Spin Theory", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null },
    recipientName: "Maya",
    values: { trade: "dj", eventKind: "wedding", eventDate: "2026-10-20", portalUrl: "https://studio-cue.com/client" },
  }).text;
  assert.match(reminder, /To help the night run smoothly/);
  assert.doesNotMatch(reminder, /photograph/i);
});

test("a DJ's couple books a vibe call and a final planning call", () => {
  const brand = { studioName: "Spin Theory", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
  const invite = renderEmailTemplate({ key: "consultation_invitation", brand, values: { trade: "dj", actionUrl: "https://studio-cue.com/x" } });
  assert.equal(invite.subject, "Choose a vibe call time with Spin Theory");
  assert.doesNotMatch(invite.text, /photograph/i);
  const final = renderEmailTemplate({ key: "consultation_invitation", brand, values: { trade: "dj", purpose: "final_details", actionUrl: "https://studio-cue.com/x" } });
  assert.equal(final.subject, "Book your final planning call with Spin Theory");
  const photo = renderEmailTemplate({ key: "consultation_invitation", brand, values: { actionUrl: "https://studio-cue.com/x" } });
  assert.equal(photo.subject, "Choose a consultation time with Spin Theory");
  const options = renderEmailTemplate({ key: "package_follow_up", brand, values: { trade: "dj", portalUrl: "https://studio-cue.com/client" } });
  assert.doesNotMatch(options.text, /photograph/i);
});

test("Cue is told what a DJ studio is, and nothing changes for a photographer", () => {
  assert.equal(tradeInstruction("photographer"), "");
  assert.equal(tradeInstruction(undefined), "");
  const dj = tradeInstruction("dj");
  assert.match(dj, /DJ business, not a photography studio/);
  assert.match(dj, /vibe call/);
  assert.match(dj, /Music & moments planner/);
  assert.match(dj, /staffs DJs only/);
  for (const path of ["functions/src/ai/copilot.ts", "functions/src/ai/message-draft.ts", "functions/src/ai/studio-voice.ts", "functions/src/ai/communications.ts"]) {
    assert.match(read(path), /tradeInstruction\(/, path);
  }
});

test("setup and help speak to a DJ", () => {
  const setup = read("components/setup/setup-conversation.tsx");
  assert.match(setup, /ask: "What events do you play\?"/);
  assert.match(setup, /const base = defaultInquiryFormFor\(trade\);/);
  assert.ok(glossaryFor("studio", "dj").some((term) => term.id === "mc-script"));
  assert.ok(!glossaryFor("studio").some((term) => term.id === "mc-script"));
  assert.equal(tradeVocab("dj").consultation, "Vibe call");
});
