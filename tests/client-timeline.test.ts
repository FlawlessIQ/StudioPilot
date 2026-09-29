import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { scheduleItemClock, scheduleZoneLabel } from "../features/schedules/item-clock";

/**
 * The couple's timeline (M4 of the mobile-first plan): the event's zone in
 * words, approval only of the version under review, and a timeline that stays
 * visible after the couple asks for changes.
 */

test("the event's zone is named in words, and an unknown zone is not guessed at", () => {
  assert.equal(scheduleZoneLabel("America/New_York"), "Eastern Time");
  assert.equal(scheduleZoneLabel("Not/AZone"), null);
  assert.equal(scheduleZoneLabel(undefined), null);
});

test("an item's clock is read in the event's zone, not the phone's", () => {
  const clock = scheduleItemClock({ startAt: "2027-06-12T17:00:00-04:00" }, "America/New_York");
  assert.equal(clock?.start, "5:00 PM");
});

test("a couple can only answer the version that is waiting for them", () => {
  const source = readFileSync("functions/src/planning/commands.ts", "utf8");
  assert.match(
    source,
    /role === "client" && current\.get\("status"\) !== "client_review"\)\s*throw new Error\("SCHEDULE_NOT_IN_REVIEW"\)/,
  );
});

test("a timeline the couple asked to change stays visible to them", () => {
  const source = readFileSync("app/api/client/portal/route.ts", "utf8");
  const filters = source.match(/\["client_review", "approved", "published"[^\]]*\]/g) ?? [];
  assert.equal(filters.length, 2);
  for (const filter of filters) assert.match(filter, /"changes_requested"/);
});

test("the timeline's change request is not a <select> in the phone's zone", () => {
  const source = readFileSync("components/client/kit/client-schedule.tsx", "utf8");
  assert.doesNotMatch(source, /<select\s/);
  assert.doesNotMatch(source, /toLocaleTimeString/);
});
