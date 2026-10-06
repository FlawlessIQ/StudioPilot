import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clockOf,
  eventZone,
  isoToWallClock,
  naiveToIso,
  spokenClock,
  wallClockToIso,
} from "@/features/schedules/day-clock";
import { flowEnds, pinnedEnds, planDay, planItems, ruleTarget, titleIsTbd, type DayRule } from "@/features/schedules/day-plan";

/**
 * The wedding day laid out from the couple's answers and the studio's timings
 * (GR Productions, 2026-10-06: the run of show was "too strict"), and the
 * timezone bug that put GR's 5:00 PM first look at 1:00 PM.
 */

const NY = "America/New_York";
const read = (path: string) => readFileSync(path, "utf8");

// GR Productions' own timing rules, as they are on production.
const GR_RULES: DayRule[] = [
  { id: "r1", name: "Ceremony", anchor: "ceremony_start", offsetMinutes: 0, durationMinutes: 30 },
  { id: "r2", name: "Coverage Start", anchor: "ceremony_start", offsetMinutes: -240, durationMinutes: 240 },
  { id: "r3", name: "Couple Portraits", anchor: "Cocktail_hour_start", offsetMinutes: 0, durationMinutes: 30 },
  { id: "r4", name: "Family Porrtraits", anchor: "ceremony_start", offsetMinutes: 75, durationMinutes: 45 },
  { id: "r5", name: "Coverage End", anchor: "coverage_end", offsetMinutes: 0, durationMinutes: 15 },
  { id: "r6", name: "First Look", anchor: "ceremony_start", offsetMinutes: -195, durationMinutes: 45 },
];

const clockAt = (iso: string) => isoToWallClock(iso, NY)!.clock;
const lines = (answers: Record<string, unknown>, rules: DayRule[] = GR_RULES, coverageMinutes = 480) => {
  const plan = planDay({ answers, rules, coverageMinutes, venue: "Primavera Regency" });
  const items = planItems(plan, { eventDate: "2027-08-17", timeZone: NY, idFor: (index) => `line_${index}` });
  return { plan, items, at: (title: string) => items.find((item) => item.title.startsWith(title)) };
};

test("a wall clock at the wedding is the same moment whatever zone the laptop or server is in", () => {
  // August is daylight time in New York (UTC-4); January is standard (UTC-5).
  assert.equal(wallClockToIso("2027-08-17", "17:00", NY), "2027-08-17T21:00:00.000Z");
  assert.equal(wallClockToIso("2027-01-16", "17:00", NY), "2027-01-16T22:00:00.000Z");
  // The spring-forward day itself.
  assert.equal(wallClockToIso("2027-03-14", "16:00", NY), "2027-03-14T20:00:00.000Z");
  assert.equal(isoToWallClock("2027-08-17T21:00:00.000Z", NY)?.clock, "17:00");
  assert.equal(isoToWallClock("2027-08-18T03:30:00.000Z", NY)?.date, "2027-08-17");
  // The AI's bare "17:00" is the venue's 5 PM, not UTC's (the 1:00 PM first look).
  assert.equal(naiveToIso("2027-08-17T17:00", NY), "2027-08-17T21:00:00.000Z");
  assert.equal(naiveToIso("2027-08-17T17:00:00-04:00", NY), "2027-08-17T21:00:00.000Z");
  assert.equal(naiveToIso("2027-08-17T21:00:00Z", NY), "2027-08-17T21:00:00.000Z");
  assert.equal(clockOf("4:30 PM"), "16:30");
  assert.equal(clockOf("4pm"), "16:00");
  assert.equal(clockOf("16:30"), "16:30");
  assert.equal(clockOf("12am"), "00:00");
  assert.equal(clockOf("TBD"), null);
  assert.equal(spokenClock("16:05"), "4:05 PM");
  assert.equal(eventZone("Not/AZone", "America/Chicago"), "America/Chicago");
  assert.equal(eventZone(null, undefined), NY);
});

test("the clock is one rule: the functions copy matches", () => {
  assert.equal(read("features/schedules/day-clock.ts"), read("functions/src/planning/day-clock.ts"));
});

test("a studio's rule names find their milestone, typos and all", () => {
  assert.equal(ruleTarget("Family Porrtraits"), "family");
  assert.equal(ruleTarget("First Look"), "first_look");
  assert.equal(ruleTarget("Couple Portraits"), "couple_portraits");
  assert.equal(ruleTarget("Coverage End"), "coverage_end");
  assert.equal(ruleTarget("Coverage Start"), "arrive");
  assert.equal(ruleTarget("Sunset portraits"), "couple_portraits");
  assert.equal(ruleTarget("Sparkler exit"), "night");
  assert.equal(ruleTarget("Bouquet toss"), null);
});

test("one venue with a first look: GR's rules lead, and the bride's milestones run up to the first look", () => {
  const { plan, items, at } = lines({
    "ceremony-time": "16:00",
    "cocktail-hour-time": "16:30",
    "reception-time": "18:00",
    "ceremony-location": "Primavera Regency",
    "reception-location": "Primavera Regency",
    "getting-ready": "140 Briarwood Rd",
    "first-look": "Yes",
  });
  assert.equal(plan.churchDay, false);
  assert.equal(plan.firstLook, true);
  // His rule: first look 3h15 before a 4:00 ceremony.
  assert.equal(clockAt(at("First look")!.startAt), "12:45");
  assert.match(at("First look")!.sourceReferences[0]!.label, /Your timing: First Look/);
  // Counted back from it, not stacked on it.
  assert.equal(clockAt(at("Bride in dress")!.startAt), "12:15");
  assert.equal(clockAt(at("Bride in dress")!.endAt), "12:45");
  assert.equal(clockAt(at("Details with the bride")!.startAt), "11:30");
  // His family-photo rule puts them after the ceremony, during cocktails.
  assert.equal(clockAt(at("Bridal party and family photos")!.startAt), "17:15");
  assert.equal(clockAt(at("Hide the couple")!.startAt), "15:30");
  // The couple's own times stand.
  assert.equal(at("Ceremony")!.sourceReferences[0]!.label, "From their form");
  assert.equal(clockAt(at("Cocktail hour")!.startAt), "16:30");
  assert.equal(clockAt(at("Cocktail hour")!.endAt), "17:30");
  // A first look with nothing until the hide is 45 minutes and a gap, not three hours.
  assert.equal(clockAt(at("First look")!.endAt), "13:30");
  // No couple portraits of their own on a first-look day.
  assert.equal(at("Couple portraits"), undefined);
  // Coverage from his rule: 4 hours before the ceremony, 8 hours booked.
  assert.equal(plan.coverageStart, "12:00");
  assert.equal(plan.coverageEnd, "20:00");
  assert.equal(clockAt(items.at(-1)!.endAt), "20:00");
  // His rules leave details before coverage starts, and the plan says so.
  assert.ok(plan.notes.some((note) => /Details with the bride is before coverage starts \(12:00 PM\)/.test(note)));
  // Every line is on the wedding's day, in order, each ending where it should.
  for (const [index, item] of items.entries()) {
    assert.ok(Date.parse(item.endAt) > Date.parse(item.startAt), item.title);
    if (index) assert.ok(Date.parse(item.startAt) >= Date.parse(items[index - 1]!.startAt));
  }
});

test("a church day: travel both ways, family photos at the church, couple portraits at cocktails", () => {
  const { plan, at } = lines(
    {
      "ceremony-time": "15:00",
      "ceremony-location": "St Rose of Lima",
      "reception-location": "Primavera Regency",
      "getting-ready": "140 Briarwood Rd",
    },
    [],
  );
  assert.equal(plan.churchDay, true);
  assert.equal(plan.firstLook, false);
  assert.equal(clockAt(at("Travel to the ceremony")!.startAt), "14:30");
  assert.equal(at("Travel to the ceremony")!.location, "St Rose of Lima");
  assert.equal(at("Travel to the ceremony")!.travelMinutes, 30);
  assert.equal(clockAt(at("Bridal party and family photos")!.startAt), "15:30");
  assert.equal(at("Bridal party and family photos")!.location, "St Rose of Lima");
  assert.equal(clockAt(at("Travel to the reception")!.startAt), "16:15");
  assert.equal(clockAt(at("Cocktail hour")!.startAt), "16:45");
  assert.equal(clockAt(at("Couple portraits")!.startAt), "16:45");
  assert.equal(at("Couple portraits")!.location, "Primavera Regency");
  assert.equal(at("Hide the couple"), undefined);
  assert.ok(plan.notes.some((note) => /30-minute guess/.test(note)));
});

test("the couple's own time beats the studio's rule, and their TBD says so on the line", () => {
  const { at } = lines({
    "ceremony-time": "4:00 PM",
    "first-look-time": "13:30",
    "dinner-time": "TBD",
    "reception-location": "Primavera Regency",
  });
  assert.equal(clockAt(at("First look")!.startAt), "13:30");
  assert.equal(at("First look")!.sourceReferences[0]!.label, "From their form");
  const dinner = at("Dinner")!;
  assert.ok(titleIsTbd(dinner.title));
  assert.equal(dinner.sourceReferences[0]!.label, "Their form: TBD");
});

test("no ceremony time: nothing invented, and the studio is told why", () => {
  const { plan, items } = lines({ "reception-time": "18:00" });
  assert.equal(items.length, 0);
  assert.match(plan.notes[0]!, /no ceremony time yet/);
});

test("booked hours that end into the reception are flagged, not hidden", () => {
  const { plan } = lines(
    { "ceremony-time": "15:00", "reception-time": "19:00", "ceremony-location": "Church", "reception-location": "Hall" },
    GR_RULES,
    480,
  );
  assert.ok(plan.notes.some((note) => /Coverage ends at 7:00 PM/.test(note)));
});

test("each block runs to the next, keeps an end the studio set, and the last runs to coverage end", () => {
  const items = [
    { id: "b", startAt: "2027-08-17T18:00:00.000Z", endAt: "2027-08-17T18:00:00.000Z" },
    { id: "a", startAt: "2027-08-17T17:00:00.000Z", endAt: "2027-08-17T17:00:00.000Z" },
    { id: "c", startAt: "2027-08-17T19:00:00.000Z", endAt: "2027-08-17T19:20:00.000Z" },
  ];
  const flowed = flowEnds(items, new Set(["c"]), "2027-08-17T23:00:00.000Z");
  // Order kept, so a row doesn't jump while its time is typed.
  assert.deepEqual(flowed.map((item) => item.id), ["b", "a", "c"]);
  assert.equal(flowed[1]!.endAt, "2027-08-17T18:00:00.000Z");
  assert.equal(flowed[0]!.endAt, "2027-08-17T19:00:00.000Z");
  assert.equal(flowed[2]!.endAt, "2027-08-17T19:20:00.000Z");
  // Unpinned, the last runs to coverage end.
  assert.equal(flowEnds(items, new Set(), "2027-08-17T23:00:00.000Z")[2]!.endAt, "2027-08-17T23:00:00.000Z");
  // A saved version's deliberate gap is read back as the studio's.
  assert.deepEqual([...pinnedEnds(flowed, "2027-08-17T23:00:00.000Z")], ["c"]);
});

test("the AI draft's bare times are the venue's, and a schedule publishes in the wedding's zone", () => {
  const ai = read("functions/src/ai/schedule.ts");
  assert.doesNotMatch(ai, /\? `\$\{value\}Z`\s*:\s*value/, "a bare time must not be read as UTC");
  assert.match(ai, /naiveToIso\(item\.startAt, zone\)/);
  const commands = read("functions/src/planning/commands.ts");
  assert.match(commands, /timezone: scheduleZone,\s*items: currentItems,/);
  assert.match(commands, /eventZone\(scheduleProject\.get\("timezone"\), parsed\.input\.timezone\)/);
  const editor = read("components/planning/ai-schedule-generator.tsx");
  assert.doesNotMatch(editor, /timezone: Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.doesNotMatch(editor, /type="datetime-local" value=\{toLocalInput/, "rows edit one time, at the wedding");
  assert.doesNotMatch(editor, /Move up|Move down/, "the list sorts itself");
  assert.doesNotMatch(editor, /source\.type\.replaceAll\("_", " "\)/, "sources in the studio's words");
});
