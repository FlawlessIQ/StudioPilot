import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCents,
  formatCentsExact,
  formatCentsOrPlaceholder,
} from "../lib/format/money.ts";
import {
  daysUntilEvent,
  describeEventProximity,
  eventDateHasPassed,
  formatEventDate,
  formatEventDateLong,
  parseEventDate,
} from "../lib/format/event-date.ts";

test("money rounds to whole dollars for headline figures", () => {
  assert.equal(formatCents(987_800), "$9,878");
  assert.equal(formatCents(191_049), "$1,910");
  assert.equal(formatCents(0), "$0");
});

test("money is exact where a client could reconcile it", () => {
  assert.equal(formatCentsExact(987_812), "$9,878.12");
  assert.equal(formatCentsExact(5), "$0.05");
});

test("money tolerates absent values instead of rendering NaN", () => {
  assert.equal(formatCents(null), "$0");
  assert.equal(formatCents(undefined), "$0");
  assert.equal(formatCentsOrPlaceholder(987_800, true), "—");
  assert.equal(formatCentsOrPlaceholder(987_800, false), "$9,878");
});

test("event dates parse as local days, never shifted by a timezone", () => {
  const parsed = parseEventDate("2026-08-15");
  assert.ok(parsed);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 7);
  assert.equal(parsed.getDate(), 15);
});

test("event dates never render as raw ISO strings", () => {
  const now = new Date(2026, 7, 18);
  assert.equal(formatEventDate("2026-08-15", now), "Aug 15");
  assert.equal(formatEventDate("2027-08-15", now), "Aug 15, 2027");
  assert.equal(formatEventDateLong("2026-08-15"), "Saturday, August 15");
});

test("an unparseable date degrades to words, not an error", () => {
  assert.equal(parseEventDate(""), null);
  assert.equal(parseEventDate(undefined), null);
  assert.equal(formatEventDate(null), "Date to confirm");
  assert.equal(daysUntilEvent("not a date"), null);
});

test("days until an event counts whole local days in both directions", () => {
  const now = new Date(2026, 7, 18, 23, 30);
  assert.equal(daysUntilEvent("2026-08-18", now), 0);
  assert.equal(daysUntilEvent("2026-08-19", now), 1);
  assert.equal(daysUntilEvent("2026-08-15", now), -3);
});

test("proximity reads the way a photographer would say it", () => {
  const now = new Date(2026, 7, 18);
  assert.equal(describeEventProximity("2026-08-18", now), "today");
  assert.equal(describeEventProximity("2026-08-19", now), "tomorrow");
  assert.equal(describeEventProximity("2026-08-17", now), "yesterday");
  assert.equal(describeEventProximity("2026-08-30", now), "in 12 days");
  assert.equal(describeEventProximity("2026-08-15", now), "3 days ago");
});

test("a passed event date is detectable — the demo tenant's silent failure", () => {
  const now = new Date(2026, 7, 18);
  // Maya & Theo: event 2026-08-15, still in PLANNING on 2026-08-18.
  assert.equal(eventDateHasPassed("2026-08-15", now), true);
  assert.equal(eventDateHasPassed("2026-08-18", now), false, "today has not passed");
  assert.equal(eventDateHasPassed("2026-09-04", now), false);
  assert.equal(eventDateHasPassed(null, now), false, "unknown dates are not overdue");
});
