import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eventHasPassed,
  portalEmptyNotice,
  type PortalEmptyArea,
} from "@/features/client/portal-day";

/**
 * The rule this file holds: an empty portal page says something true and
 * specific, and knows whether the day has been and gone.
 */

const AREAS: PortalEmptyArea[] = ["payments", "documents", "delivery", "reviews"];

test("the day has passed only when today is after it", () => {
  assert.equal(eventHasPassed("2026-08-15", "2026-09-03"), true);
  assert.equal(eventHasPassed("2026-08-15", "2026-08-15"), false);
  assert.equal(eventHasPassed("2026-08-15", "2026-07-01"), false);
  assert.equal(eventHasPassed(null, "2026-09-03"), false);
  assert.equal(eventHasPassed("2026-08-15", null), false);
});

test("no page reuses the filler the walk found", () => {
  // The four shared it verbatim. "Only approved project details appear here"
  // is StudioCue talking to itself; "Nothing to complete" was the wrong verb.
  for (const area of AREAS) {
    for (const passed of [false, true]) {
      const notice = portalEmptyNotice(area, passed);
      const all = `${notice.title} ${notice.detail}`;
      assert.doesNotMatch(all, /Nothing to complete/, `${area} passed=${passed}`);
      assert.doesNotMatch(all, /approved project details/i, `${area} passed=${passed}`);
      assert.doesNotMatch(all, /prepares this area/i, `${area} passed=${passed}`);
    }
  }
});

test("every page says something different from every other", () => {
  for (const passed of [false, true]) {
    const titles = AREAS.map((area) => portalEmptyNotice(area, passed).title);
    const details = AREAS.map((area) => portalEmptyNotice(area, passed).detail);
    assert.equal(new Set(details).size, AREAS.length, `details passed=${passed}`);
    // Titles may legitimately repeat across areas only when the sentence is
    // exact and true for both; today none do.
    assert.equal(new Set(titles).size, AREAS.length, `titles passed=${passed}`);
  }
});

test("delivery, after the day, says the work is in progress and how to ask", () => {
  // Nineteen days post-wedding the page said only "will appear after
  // delivery". No date is fabricated — none exists to show — but it says what
  // is happening and that they can ask when.
  const notice = portalEmptyNotice("delivery", true);
  assert.match(notice.title, /being worked on/);
  assert.match(notice.detail, /message them/i);
  assert.doesNotMatch(notice.detail, /\d{4}-\d{2}-\d{2}/);
});

test("the day changes what an empty page says", () => {
  for (const area of AREAS) {
    assert.notEqual(
      portalEmptyNotice(area, false).detail,
      portalEmptyNotice(area, true).detail,
      area,
    );
  }
});
