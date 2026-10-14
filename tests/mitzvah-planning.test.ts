import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MITZVAH_ANSWER_KEYS, planMitzvahDay, serviceRules } from "@/features/schedules/mitzvah-plan";
import { planBuiltDay } from "@/features/schedules/built-day";
import { eventDetailsFrom } from "@/features/contracts/event-details";
import { buildCrewBrief } from "@/features/questionnaires/crew-brief";
import { recommendedQuestionnaires } from "@/features/questionnaires/recommended-templates";
import { kindMomentsFor } from "@/features/schedules/standard-moments";
import { resolvePlanningTimeline } from "../functions/src/planning/planning-timeline";
import { planningFormTemplate, shotListTemplateFor } from "../functions/src/planning/planning-form-scheduler";

/**
 * A bar or bat mitzvah's photo and video planning (docs/mitzvah-journey-plan-2026-10-14.md,
 * Phase 3): its own forms, a day laid out from the party, Schedule A's
 * service and party, and the synagogue's rules on the crew's sheet.
 */

const forms = recommendedQuestionnaires();
const form = (id: string) => forms.find((entry) => entry.id === id)!;
const fieldIds = (id: string) => form(id).sections.flatMap((section) => section.fields.map((field) => field.id));

test("the party is the anchor: the evening in its usual order from the start time", () => {
  const plan = planMitzvahDay({ answers: { "party-start-time": "18:00" }, coverageMinutes: 360, venue: "Harbor Hall" });
  assert.deepEqual(
    plan.rows.map((row) => `${row.time} ${row.title}`),
    [
      "16:45 Photo and video arrive",
      "16:45 Family portraits",
      "18:00 Cocktail hour",
      "19:00 Grand entrance",
      "19:05 Hora",
      "19:20 Blessings over the challah and wine",
      "19:30 Parents' speech and toast",
      "19:45 Dinner",
      "20:45 Candle lighting",
      "21:15 Montage",
      "21:25 Dancing and games",
      "22:00 Cake",
      "22:30 Last dance",
    ],
  );
  assert.equal(plan.coverageEnd, "22:45");
  assert.ok(plan.rows.every((row) => row.where === "Harbor Hall"));
  // Only what they answered, by default in the editor; the rest comes on request.
  const answered = planMitzvahDay({ answers: { "party-start-time": "18:00", "hora-time": "7:10 PM" }, answeredOnly: true });
  assert.deepEqual(answered.rows.map((row) => row.title), ["Photo and video arrive", "Cocktail hour", "Hora"]);
  assert.ok(answered.withheld > 0);
});

test("no party time, no plan — and the service keeps the cameras out when the synagogue says", () => {
  assert.deepEqual(planMitzvahDay({ answers: {} }).rows, []);
  const plan = planMitzvahDay({
    answers: {
      "party-start-time": "19:00",
      "service-time": "9:30 AM",
      synagogue: "Temple Beth El",
      "service-photo-rules": "No photography during the service",
      "portrait-session-date": "2027-05-06",
    },
    coverageMinutes: 300,
  });
  const service = plan.rows.find((row) => row.title.startsWith("Service"))!;
  assert.equal(service.title, "Service (no photography)");
  assert.equal(service.where, "Temple Beth El");
  // Coverage is the evening's, not from the morning service.
  assert.equal(plan.coverageStart, "17:45");
  assert.ok(plan.notes.some((note) => /no photography/.test(note)));
  assert.ok(plan.notes.some((note) => /portrait session/.test(note)));
  assert.equal(serviceRules({ "service-photo-rules": "Portraits only, before or after" }), "window");
  assert.equal(serviceRules({ "service-photo-rules": "Photography allowed" }), "allowed");
  assert.equal(serviceRules({ "service-photo-rules": "Not sure yet" }), null);
});

test("a second team takes the kids' room", () => {
  const plan = planMitzvahDay({ answers: { "party-start-time": "18:00" }, secondTeam: true });
  const kids = plan.rows.find((row) => row.title === "Kids' room")!;
  assert.equal(kids.team, "second");
  assert.equal(plan.rows.find((row) => row.title === "Cocktail hour")!.team, "first");
});

test("the editor lays out a mitzvah's day, and a wedding's as it always did", () => {
  const answers = { "party-start-time": "18:00", "ceremony-time": "16:00" };
  assert.ok(planBuiltDay("mitzvah", { answers }).rows.some((row) => row.title === "Candle lighting"));
  assert.ok(planBuiltDay("wedding", { answers }).rows.some((row) => row.title === "Ceremony"));
  assert.ok(kindMomentsFor({ eventKind: "mitzvah" }).some((moment) => moment.title === "Candle lighting"));
});

test("the mitzvah forms ask what the day plan, Schedule A and the crew read, and say nothing of a wedding", () => {
  for (const id of ["mitzvah-details", "mitzvah-final-schedule", "mitzvah-shot-list"]) {
    assert.equal(form(id).eventTypeId, "mitzvah", id);
    assert.deepEqual(form(id).trades, ["photographer"], id);
    assert.doesNotMatch(JSON.stringify(form(id)), /\b(wedding|bride|groom|couple|ceremony)\b/i, id);
  }
  // Every time on "Your party, in order" is one the day plan reads.
  const planKeys = new Set(Object.values(MITZVAH_ANSWER_KEYS).flat());
  const evening = form("mitzvah-final-schedule").sections.find((section) => section.id === "day-in-order")!;
  for (const field of evening.fields) assert.ok(planKeys.has(field.id), field.id);
  for (const id of ["party-start-time", "synagogue", "party-location", "service-photo-rules", "honoree-name"]) {
    assert.ok(fieldIds("mitzvah-details").includes(id), id);
    assert.ok(fieldIds("mitzvah-final-schedule").includes(id), id);
  }
  assert.ok(fieldIds("mitzvah-shot-list").includes("candle-lighting-list"));
});

test("Schedule A: the service and the party, required from booking", () => {
  const details = eventDetailsFrom({
    eventType: "Bar mitzvah",
    eventKind: "mitzvah",
    kindDetails: { parts: "mitzvah", title: "Mitzvah details" },
    date: "Saturday, May 15, 2027",
    venue: null,
    coverage: "2 photographers, 6 hours",
    answers: [
      { question: "Synagogue", answer: "Temple Beth El, 12 Elm St" },
      { question: "Party location", answer: "Harbor Hall, 1 Pier Rd" },
      { question: "Party start time", answer: "6:00 PM" },
      { question: "The synagogue's photography rules for the service", answer: "No photography during the service" },
    ],
    trade: "photographer",
  });
  assert.equal(details.title, "Mitzvah details");
  const labels = details.rows.map((row) => row.label);
  assert.ok(labels.includes("Service"));
  assert.ok(labels.includes("Party"));
  assert.ok(!labels.some((label) => /ceremony|reception|getting ready/i.test(label)), labels.join(", "));
  assert.deepEqual(details.missing, []);
  // Without them, they're asked for before the agreement goes.
  const bare = eventDetailsFrom({
    eventType: "Bar mitzvah",
    kindDetails: { parts: "mitzvah", title: "Mitzvah details" },
    date: null,
    venue: null,
    coverage: null,
    answers: [],
    trade: "photographer",
  });
  assert.deepEqual(bare.missing, ["Service", "Party", "Times"]);
});

test("the synagogue's rules are the first thing the crew read", () => {
  const brief = buildCrewBrief({
    sections: form("mitzvah-final-schedule").sections,
    answers: {
      "service-photo-rules": "No photography during the service",
      "honoree-name": "Sam",
      "candle-lighting-list": "In memory — Grandpa Saul\nGrandparents — Ruth and Mel",
    },
  });
  assert.match(brief.beforeYouShoot.map((item) => item.text).join("\n"), /No photography during the service/);
  assert.ok(brief.onTheDay.some((item) => /Grandpa Saul/.test(item.text)));
});

test("a mitzvah job gets its own planning form and shot list, never the shot list as its form", () => {
  const template = (id: string, recommendedId: string, eventTypeId = "mitzvah") => ({
    id,
    name: form(recommendedId).name,
    eventTypeId,
    recommendedId,
    status: "active",
    archivedAt: null,
    createdAt: "2026-10-14T12:00:00.000Z",
  });
  const studio = {
    timeline: resolvePlanningTimeline({ shotListTemplateId: "w-shot" }),
    templates: [
      template("m-details", "mitzvah-details"),
      template("m-shot", "mitzvah-shot-list"),
      template("m-final", "mitzvah-final-schedule"),
      template("w-shot", "wedding-shot-list", "wedding"),
    ],
    inquiryFormId: "m-details",
    trade: "photographer",
  };
  assert.equal(planningFormTemplate(studio as never, "mitzvah", false)?.id, "m-final");
  assert.equal(shotListTemplateFor(studio as never, "mitzvah")?.id, "m-shot");
  assert.equal(shotListTemplateFor(studio as never, "wedding")?.id, "w-shot");
});

test("offering the kind copies its forms in, once", () => {
  const commands = readFileSync("functions/src/crm/commands.ts", "utf8");
  const save = commands.slice(commands.indexOf('if (command.type === "setInquiryForm") {'));
  assert.match(save, /OFFERED_KIND_FORMS\.includes\(kind\)/);
  assert.match(save, /recommendedFor\(tradeOf\(tenantForForms\.get\("trade"\)\), offeredKinds\)\.filter\(\(form\) => !had\.has\(form\.id\)\)/);
  assert.match(save, /recommendedId: form\.id,/);
});
