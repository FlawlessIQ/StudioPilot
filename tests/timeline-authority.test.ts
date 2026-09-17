import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  compareTimelines,
  formatMinutes,
  localMinutes,
  parsePlannerTimeline,
} from "@/features/schedules/timeline-authority";

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

test("reads a planner's timeline the way planners write one", () => {
  const items = parsePlannerTimeline(
    [
      "Smith–Jones Wedding · Oct 10 2026",
      "",
      "10:00 AM – Hair & makeup begins",
      "12:30 Bride dressed",
      "1:15 - First look",
      "3:30 PM: Ceremony",
      "4-5pm Cocktail hour",
      "• 6 | Grand entrance",
      "15:45 Family formals",
      "Guest count: 140",
      "4 bridesmaids",
    ].join("\n"),
  );
  assert.deepEqual(items, [
    { minutes: at(10), title: "Hair & makeup begins" },
    // No meridiem: morning rows stay morning until someone says PM.
    { minutes: at(12, 30), title: "Bride dressed" },
    { minutes: at(13, 15), title: "First look" },
    { minutes: at(15, 30), title: "Ceremony" },
    { minutes: at(16), title: "Cocktail hour" },
    { minutes: at(18), title: "Grand entrance" },
    { minutes: at(15, 45), title: "Family formals" },
  ]);
});

test("a time with no am/pm follows the last one given", () => {
  assert.deepEqual(parsePlannerTimeline("9:00 am Getting ready\n11:30 Details"), [
    { minutes: at(9), title: "Getting ready" },
    { minutes: at(11, 30), title: "Details" },
  ]);
  assert.deepEqual(parsePlannerTimeline("5:00 pm Cocktails\n7:30 Dinner"), [
    { minutes: at(17), title: "Cocktails" },
    { minutes: at(19, 30), title: "Dinner" },
  ]);
});

test("times read in the wedding's own time zone", () => {
  // 7:30 PM UTC is 3:30 PM in New York in October.
  assert.equal(localMinutes("2026-10-10T19:30:00.000Z", "America/New_York"), at(15, 30));
  assert.equal(formatMinutes(at(15, 30)), "3:30 PM");
  assert.equal(formatMinutes(at(0, 5)), "12:05 AM");
  assert.equal(formatMinutes(at(12)), "12:00 PM");
});

test("shows where the run of show has drifted from the planner's", () => {
  const ours = [
    { title: "Getting ready", startAt: "2026-10-10T15:00:00.000Z" }, // 11:00
    { title: "First look photos", startAt: "2026-10-10T17:15:00.000Z" }, // 1:15
    { title: "Ceremony", startAt: "2026-10-10T19:30:00.000Z" }, // 3:30
    { title: "Golden hour portraits", startAt: "2026-10-10T22:30:00.000Z" }, // 6:30
  ];
  const planner = parsePlannerTimeline(
    "11:00 AM Getting ready\n1:17 PM First look\n4:00 PM Ceremony begins\n5:00 PM Cocktail hour",
  );
  const differences = compareTimelines({ ours, timezone: "America/New_York", planner });
  assert.deepEqual(differences, [
    { kind: "moved", title: "Ceremony", plannerTitle: "Ceremony begins", ours: at(15, 30), planner: at(16) },
    { kind: "only_planner", title: "Cocktail hour", planner: at(17) },
    { kind: "only_ours", title: "Golden hour portraits", ours: at(18, 30) },
  ]);
});

test("the same timeline twice has nothing to report", () => {
  const planner = parsePlannerTimeline("3:30 PM Ceremony\n4:00 PM Family formals");
  assert.deepEqual(
    compareTimelines({
      ours: [
        { title: "Ceremony", startAt: "2026-10-10T19:30:00.000Z" },
        { title: "Family formals", startAt: "2026-10-10T20:00:00.000Z" },
      ],
      timezone: "America/New_York",
      planner,
    }),
    [],
  );
});

test("features/ and functions/ read the planner's timeline identically", () => {
  assert.equal(
    readFileSync("functions/src/planning/timeline-authority.ts", "utf8"),
    readFileSync("features/schedules/timeline-authority.ts", "utf8").replace(
      "Duplicated at functions/src/planning/timeline-authority.ts;",
      "Duplicated from features/schedules/timeline-authority.ts;",
    ),
  );
});

test("the planner's timeline is read on the server, not trusted from the browser", () => {
  const commands = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.match(commands, /type: z\.literal\("setTimelineAuthority"\)/);
  const handler = commands.slice(
    commands.indexOf('parsed.type === "setTimelineAuthority"'),
    commands.indexOf('parsed.type === "setInsuranceRequirement"'),
  );
  assert.match(handler, /if \(!internalRoles\.has\(role\)\) throw new Error\("FORBIDDEN"\)/);
  assert.match(handler, /snapshot\.get\("tenantId"\) !== parsed\.tenantId/);
  // Times come from the server's own parse of the pasted text.
  assert.match(handler, /const items = parsePlannerTimeline\(text\);/);
  assert.match(handler, /if \(!items\.length\) throw new Error\("PLANNER_TIMELINE_UNREADABLE"\)/);
});

test("vendors and crew are told when the planner keeps the timeline", () => {
  assert.match(
    readFileSync("app/share/[token]/page.tsx", "utf8"),
    /project\.timelineAuthority === "planner"/,
  );
  const crew = readFileSync("components/crew/live-crew-views.tsx", "utf8");
  assert.match(crew, /project\?\.timelineAuthority === "planner" \? <PlannerLedNote\/> : null/);
  // And on the copy saved for a venue with no signal.
  assert.match(crew, /\{brief\.plannerLed \? <PlannerLedNote\/> : null\}/);
});
