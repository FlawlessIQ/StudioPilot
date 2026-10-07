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

// --- the run of show the studio hands out ---------------------------------------
import { crewLabels } from "@/features/schedules/crew-labels";
import { runOfShowDocument, timeRange } from "../functions/src/planning/run-of-show-doc.ts";

test("crew are named the way a studio writes them: leads first, photo and video numbered apart", () => {
  const labels = crewLabels([
    { id: "a", role: "Second photographer", order: "2026-09-02" },
    { id: "b", role: "Videographer", order: "2026-09-03" },
    { id: "c", role: "Lead photographer", order: "2026-09-05" },
    { id: "d", role: "Second video", order: "2026-09-01" },
  ]);
  assert.deepEqual(
    ["a", "b", "c", "d"].map((id) => labels.get(id)?.label),
    ["P2", "V1", "P1", "V2"],
  );
  assert.equal(read("features/schedules/crew-labels.ts"), read("functions/src/planning/crew-labels.ts"));
});

test("GR's own run of show, rebuilt: the wedding's times, team chips, and who concludes when", () => {
  const z = NY;
  const day = "2027-06-12";
  const at = (clock: string) => wallClockToIso(day, clock, z)!;
  const home = "501 South Ave West, Apt 201, Westfield, NJ 07090";
  const church = "Parish Community of Saint Helen, 1600 Rahway Avenue, Westfield, NJ 07090";
  const inn = "The Ryland Inn, 115 Old Hwy 28, White House Station, NJ 08889";
  const everyone = ["p1", "v1", "p2", "v2"];
  const line = (start: string, end: string, title: string, location: string, crewIds: string[], notes = "") => ({
    startAt: at(start), endAt: at(end), title, location, crewIds, notes,
  });
  const document = runOfShowDocument({
    items: [
      line("12:30", "13:00", "Arrival & detail photos", home, ["p1", "v1"], "dress, rings, flowers, shoes, invitations"),
      line("13:00", "14:00", "Groom getting ready", home, ["p2", "v2"]),
      line("14:30", "15:30", "Ceremony", church, everyone),
      line("19:45", "20:45", "Entrances, first dance, speeches, parent dances", inn, everyone),
      line("21:30", "21:30", "Cake cutting — time TBD", inn, ["p1", "v1"]),
      line("21:45", "22:00", "Night photos, dessert photos & dancing", inn, ["p1", "v1"]),
      line("22:00", "23:00", "Dancing / party", inn, ["p1"]),
    ],
    timeZone: z,
    version: 2,
    publishedAt: "2026-10-06T14:00:00Z",
    project: { name: "Gabe Rhodes Wedding", eventDate: day, eventType: "Wedding" },
    crewLabels: new Map([["p1", "P1"], ["v1", "V1"], ["p2", "P2"], ["v2", "V2"]]),
  });
  assert.equal(document.title, "Wedding Photo & Video Run of Show");
  assert.equal(document.subtitle, "Saturday, June 12, 2027 — Ceremony at Parish Community of Saint Helen — Reception at The Ryland Inn");
  assert.deepEqual(document.facts.map((fact) => fact.label), ["Getting ready", "Ceremony", "Reception", "Coverage"]);
  assert.equal(
    document.facts.at(-1)!.value,
    "Photo 1 + Video 1: 12:30 PM – 11:00 PM / 10:00 PM  |  Photo 2 + Video 2: 1:00 PM – 8:45 PM",
  );
  const [arrival, groom, ceremony, entrances, cake, night, party] = document.rows;
  assert.equal(arrival!.time, "12:30 – 1:00 PM");
  assert.deepEqual(arrival!.crew, ["P1", "V1"]);
  assert.equal(arrival!.where, "Getting ready — dress, rings, flowers, shoes, invitations");
  assert.deepEqual(groom!.crew, ["P2", "V2"]);
  // A line the whole crew is on needs no tags; the place is named briefly.
  assert.deepEqual(ceremony!.crew, []);
  assert.equal(ceremony!.where, "Parish Community of Saint Helen");
  assert.equal(entrances!.concludes, "P2 / V2 conclude 8:45 PM");
  assert.equal(cake!.time, "TBD");
  assert.equal(cake!.title, "Cake cutting");
  assert.equal(night!.concludes, "V1 concludes 10:00 PM");
  assert.equal(party!.concludes, "P1 concludes 11:00 PM");
  assert.equal(document.footer, "Version 2 · published Oct 6, 2026 · Times are Eastern Daylight Time");
  assert.equal(document.fileName, "gabe-rhodes-wedding-run-of-show-v2.pdf");
  // No raw timestamps or ids reach the page.
  assert.doesNotMatch(JSON.stringify(document), /\d{4}-\d{2}-\d{2}T|schedule_|tenant_/);
  assert.equal(timeRange("11:30", "12:15"), "11:30 AM – 12:15 PM");
  assert.equal(timeRange("21:30", "21:30"), "9:30 PM");
});

test("the PDF service lays out the document, and an older caller still gets its table", () => {
  const service = read("cloud-run/pdf/main.py");
  assert.match(service, /document: RunOfShowDocument \| None = None/);
  assert.match(service, /if data\.document is not None:\s*\n\s*return Response\(content=build_run_of_show_pdf\(data\.document\)/);
  assert.match(read("cloud-run/pdf/Dockerfile"), /COPY main\.py contract\.py run_of_show\.py/);
  const worker = read("functions/src/operations/ai-pdf.ts");
  assert.match(worker, /document:\{title:document\.title,subtitle:document\.subtitle,studio:tenantName/);
});

// --- crew tracks ---------------------------------------------------------------
import { sameTrack } from "@/features/schedules/day-plan";

test("lines run to the next line on their own track: the groom's team isn't cut off by the bride's", () => {
  const items = [
    { id: "touchups", startAt: "2027-06-12T17:00:00.000Z", endAt: "2027-06-12T17:00:00.000Z", crewIds: ["p1", "v1"] },
    { id: "groom", startAt: "2027-06-12T17:00:00.000Z", endAt: "2027-06-12T17:00:00.000Z", crewIds: ["p2", "v2"] },
    { id: "dress", startAt: "2027-06-12T17:15:00.000Z", endAt: "2027-06-12T17:15:00.000Z", crewIds: ["p1", "v1"] },
    { id: "ceremony", startAt: "2027-06-12T18:30:00.000Z", endAt: "2027-06-12T18:30:00.000Z", crewIds: [] },
  ];
  assert.equal(sameTrack(items[0]!, items[1]!), false);
  assert.equal(sameTrack(items[0]!, items[3]!), true, "a line nobody's named on is everyone's");
  const flowed = new Map(flowEnds(items, new Set(), "2027-06-13T03:00:00.000Z").map((item) => [item.id, item.endAt]));
  assert.equal(flowed.get("touchups"), "2027-06-12T17:15:00.000Z");
  assert.equal(flowed.get("groom"), "2027-06-12T18:30:00.000Z");
  assert.equal(flowed.get("dress"), "2027-06-12T18:30:00.000Z");
});

test("with a second team booked, GR's day lays out in two tracks the way his run of show does", () => {
  const plan = planDay({
    answers: {
      "ceremony-time": "14:30",
      "ceremony-end-time": "15:30",
      "cocktail-hour-time": "18:30",
      "reception-time": "19:45",
      "dinner-time": "21:00",
      coverageStartTime: "12:30",
      coverageEndTime: "23:00",
      "photo-2-start-time": "13:00",
      "photo-2-end-time": "20:45",
      "bridal-prep-end": "13:00",
      "first-look": "No",
      "getting-ready": "501 South Ave West, Westfield",
      "ceremony-location": "Saint Helen, Westfield",
      "reception-location": "The Ryland Inn",
    },
    rules: GR_RULES,
    coverageMinutes: 630,
    secondTeam: true,
  });
  const items = planItems(plan, {
    eventDate: "2027-06-12",
    timeZone: NY,
    idFor: (index) => `line_${index}`,
    teams: { first: ["p1", "v1"], second: ["p2", "v2"] },
  });
  const at = (title: string) => items.find((item) => item.title.startsWith(title))!;
  assert.deepEqual(at("Photo and video arrive").crewIds, ["p1", "v1"]);
  assert.deepEqual(at("Details with the bride").crewIds, ["p1", "v1"]);
  // The groom with the second team, at their own start, alongside the bride.
  const groom = at("Groom getting ready");
  assert.deepEqual(groom.crewIds, ["p2", "v2"]);
  assert.equal(clockAt(groom.startAt), "13:00");
  assert.equal(clockAt(groom.endAt), "14:00");
  assert.equal(clockAt(at("Touch-ups").endAt), "13:15");
  // Everyone at the ceremony; the shared reception line ends when the second team leaves.
  assert.deepEqual(at("Ceremony").crewIds, []);
  assert.equal(clockAt(at("Entrances").endAt), "20:45");
  // After their hours, the first team carries on alone.
  assert.deepEqual(at("Dinner").crewIds, ["p1", "v1"]);
  // With one team, nobody is named on anything.
  const solo = planItems(planDay({ answers: { "ceremony-time": "16:00" }, rules: [], coverageMinutes: 480 }), {
    eventDate: "2027-06-12",
    timeZone: NY,
    idFor: (index) => `solo_${index}`,
    teams: { first: ["p1"], second: [] },
  });
  assert.ok(solo.every((item) => item.crewIds.length === 0));
});

test("the editor offers the crew as P1 V1 P2 V2 chips and lays out two tracks when a second team is booked", () => {
  const editor = read("components/planning/ai-schedule-generator.tsx");
  assert.match(editor, /secondTeam: crewTags\.teams\.second\.length > 0/);
  assert.match(editor, /teams: crewTags\.teams/);
  assert.match(editor, /className=\{`schedule-line-chip is-\$\{tag\?\.trade/);
  assert.match(editor, /aria-pressed=\{on\}/);
});

// --- the form, not the rules (GR, 2026-10-06) --------------------------------
test("a wedding's day comes from the couple's form: every answered line appears, gaps are marked, no rules", () => {
  // Dionne Rhodes' Final Schedule, as GR's test couple filled it in.
  const answers = {
    "ceremony-location": "St Rose of Lima",
    "reception-location": "Primavera Regency",
    "getting-ready": "140 Briarwood Rd\nFlorham Park NJ",
    coverageStartTime: "12:00",
    coverageEndTime: "22:00",
    "ceremony-time": "15:00",
    "ceremony-end-time": "16:00",
    "cocktail-hour-time": "18:00",
    "cocktail-end-time": "19:00",
    "reception-time": "19:00",
    "details-with-bride-time": "12:30",
    "touch-ups-time": "13:00",
    "bride-in-dress-time": "13:15",
    "groom-start-time": "14:00",
    "first-look-time": "17:00",
    "hide-time": "18:00",
    "family-photos-time": "17:30",
    "dinner-time": "20:30",
    "cake-cutting-time": "21:00",
    "night-pictures-time": "21:30",
  };
  const plan = planDay({ answers, coverageMinutes: 600 });
  assert.equal(plan.churchDay, true);
  const titles = plan.rows.map((row) => row.title);
  // A church day has no hide in its shape, but the couple gave one: it stays.
  assert.ok(titles.includes("Hide the couple"));
  assert.equal(plan.rows.find((row) => row.key === "hide")?.time, "18:00");
  // Everything but the drive is theirs; the drive is a marked suggestion.
  for (const row of plan.rows) {
    if (row.key === "leave_for_ceremony" || row.key === "leave_for_reception") assert.equal(row.sourceLabel, "Suggested — check it");
    else assert.match(row.sourceLabel, /^(From their form|Coverage starts)/, row.title);
  }
  // A guessed drive that can't fit before cocktails start isn't listed.
  assert.equal(plan.rows.find((row) => row.key === "leave_for_reception"), undefined);
});

test("the wedding schedule page has one way to build the day: no timing rules, no AI draft", () => {
  const editor = read("components/planning/ai-schedule-generator.tsx");
  const layOut = editor.slice(editor.indexOf("function layOutDay()"), editor.indexOf("function addItem()"));
  assert.doesNotMatch(layOut, /rules:/, "Lay out the day reads the form only");
  assert.doesNotMatch(editor, /useTenantDocuments\("timingRules"\)/);
  assert.match(editor, /\{weddingDay \? null : <TimingRuleEditor \/>\}/);
  assert.match(editor, /\{weddingDay \? null : \(\s*<button className="button button-dark" disabled=\{busy\} type="submit">/);
  assert.match(editor, /if \(weddingDay\) \{\s*event\.preventDefault\(\);\s*layOutDay\(\);/);
  assert.doesNotMatch(read("app/studio/schedules/new/page.tsx"), /<TimingRuleEditor/);
});

test("answered only: the couple's times and TBDs, no suggested lines, and a count of what was left out", () => {
  // GR, 2026-10-07: the editor lays out only what the couple gave; suggestions come on request.
  const answers = {
    "ceremony-time": "16:30",
    "reception-time": "18:30",
    "cocktail-hour-time": "TBD",
    "ceremony-location": "The Madison Hotel",
    "reception-location": "The Madison Hotel",
  };
  const full = planDay({ answers });
  const answered = planDay({ answers, answeredOnly: true });
  assert.ok(full.rows.some((row) => row.source === "usual"), "the full plan suggests the gaps");
  assert.equal(answered.rows.filter((row) => row.source === "usual" && !row.tbd).length, 0);
  assert.ok(answered.rows.some((row) => row.key === "ceremony"));
  assert.ok(answered.rows.some((row) => row.tbd), "a TBD the couple gave stays");
  assert.equal(answered.withheld, full.rows.length - answered.rows.length);
  assert.ok(answered.withheld > 0);
  assert.equal(full.withheld, 0);
});

test("the editor lays out answered only, with a button for the rest", () => {
  const editor = readFileSync("components/planning/ai-schedule-generator.tsx", "utf8");
  assert.match(editor, /planDay\(\{ \.\.\.dayPlanInput\(\), answeredOnly: true \}\)/);
  assert.match(editor, /Suggest times for the gaps/);
});
