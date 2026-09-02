import assert from "node:assert/strict";
import { test } from "node:test";
import {
  seededManualSchedule,
  manualScheduleBlockers,
  manualScheduleItem,
  nextItemStart,
} from "@/features/planning/manual-run-of-show";

test("a manual item is a full, publishable item", () => {
  // publishSchedule validates the whole shape, so a hand-started item has to
  // carry every field the AI draft carries — with no invented sources.
  const item = manualScheduleItem("i1", "2027-09-18T15:00:00.000Z", "Ceremony");
  assert.equal(item.title, "Ceremony");
  assert.equal(item.startAt, "2027-09-18T15:00:00.000Z");
  assert.equal(item.endAt, "2027-09-18T16:00:00.000Z");
  assert.deepEqual(item.sourceReferences, []);
  assert.equal(item.visibility, "studio");
  assert.equal(item.travelMinutes, 0);
});

test("the next item starts after the latest end, not the last array slot", () => {
  const items = [
    { startAt: "2027-09-18T15:00:00.000Z", endAt: "2027-09-18T16:00:00.000Z" },
    // Retimed earlier by hand — array order is not chronological.
    { startAt: "2027-09-18T11:00:00.000Z", endAt: "2027-09-18T12:00:00.000Z" },
  ];
  assert.equal(nextItemStart(items, null), "2027-09-18T16:00:00.000Z");
});

test("the first item starts at coverage start when one is known", () => {
  assert.equal(
    nextItemStart([], "2027-09-18T11:00:00.000Z"),
    "2027-09-18T11:00:00.000Z",
  );
});

test("publishing is blocked, with a reason, on empty or backwards items", () => {
  assert.deepEqual(manualScheduleBlockers([]), ["Add at least one item."]);
  const blockers = manualScheduleBlockers([
    { title: "", startAt: "2027-09-18T11:00:00.000Z", endAt: "2027-09-18T12:00:00.000Z" },
    { title: "Rooftop", startAt: "2027-09-18T18:00:00.000Z", endAt: "2027-09-18T17:00:00.000Z" },
  ]);
  assert.equal(blockers.length, 2);
  assert.match(blockers[0] ?? "", /needs a title/);
  assert.match(blockers[1] ?? "", /ends before it starts/);
  // A good schedule has nothing to say.
  assert.deepEqual(
    manualScheduleBlockers([
      { title: "Ceremony", startAt: "2027-09-18T16:00:00.000Z", endAt: "2027-09-18T16:45:00.000Z" },
    ]),
    [],
  );
});

test("the manual draft is seeded from what the studio typed", () => {
  /**
   * "Build it myself" started a genuinely empty draft — one untitled row timed
   * from coverage start — while the form above it held the ceremony time, the
   * reception time and three locations. All of it was dropped, and the
   * provenance panel then read "Nothing from this job yet", which was false
   * even for the one field that had been used. The order matters: the studio
   * fills the form, is told AI drafting is unavailable, and takes the only
   * remaining path.
   */
  let n = 0;
  const seeded = seededManualSchedule(() => `item-${++n}`, {
    coverageStartsAt: "2027-06-12T13:00",
    coverageEndsAt: "2027-06-12T21:00",
    ceremonyTime: "2027-06-12T16:00",
    receptionTime: "2027-06-12T18:00",
    locations: "Hartley family home\nSt Stephen Church\nThe Dorrance",
  });
  assert.equal(seeded.length, 3);
  assert.deepEqual(
    seeded.map((item) => item.title),
    ["", "Ceremony", "Reception"],
  );
  // Each item runs up to the next, and the last to coverage end, so the day
  // reads as a plan rather than a column of default hours to retime.
  assert.equal(seeded[0]?.endAt, seeded[1]?.startAt);
  assert.equal(seeded[1]?.endAt, seeded[2]?.startAt);
  assert.equal(
    seeded[2]?.endAt,
    new Date("2027-06-12T21:00").toISOString(),
  );
  // The first location, on the first item. Nothing is invented for the rest.
  assert.equal(seeded[0]?.location, "Hartley family home");
  assert.equal(seeded[1]?.location, null);
});

test("seeding invents nothing when the form is empty", () => {
  let n = 0;
  const seeded = seededManualSchedule(() => `item-${++n}`, {
    coverageStartsAt: null,
    coverageEndsAt: null,
    ceremonyTime: null,
    receptionTime: null,
    locations: null,
  });
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0]?.title, "");
  assert.equal(seeded[0]?.location, null);
});

test("seeded items are ordered by time, not by which field they came from", () => {
  let n = 0;
  const seeded = seededManualSchedule(() => `item-${++n}`, {
    coverageStartsAt: "2027-06-12T13:00",
    coverageEndsAt: null,
    // A reception earlier than the ceremony is a studio typo, not a reason to
    // hand back a backwards plan that cannot be published.
    ceremonyTime: "2027-06-12T18:00",
    receptionTime: "2027-06-12T16:00",
    locations: null,
  });
  assert.deepEqual(
    seeded.map((item) => item.title),
    ["", "Reception", "Ceremony"],
  );
  for (const item of seeded) assert.ok(item.endAt > item.startAt);
});
