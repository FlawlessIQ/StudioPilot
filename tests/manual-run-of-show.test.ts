import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
