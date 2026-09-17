// Before any Date is made: a zone with daylight saving, so a whole-day window
// that spans the change is tested, not assumed.
process.env.TZ = "America/New_York";

import assert from "node:assert/strict";
import test from "node:test";
import {
  daysFromWindow,
  describeAvailability,
  windowFromDays,
} from "../features/crew/availability-days";

/**
 * Crew mark days, not minutes.
 *
 * The form stored "Sep 9 at 2:29 PM to Sep 24 at 2:29 PM" because that's when
 * the picker opened. These pin that a range of days becomes the right instants,
 * reads back as days, and says so in words.
 */

const whole = (firstDay: string, lastDay: string) => ({
  firstDay,
  lastDay,
  startTime: null,
  endTime: null,
});

test("a single day is the whole day, not a zero-length window", () => {
  const window = windowFromDays(whole("2026-09-12", "2026-09-12"));
  assert.ok("startsAt" in window);
  assert.equal(window.endsAt.valueOf() - window.startsAt.valueOf(), 24 * 3_600_000);
});

test("whole days survive a daylight-saving change and read back as days", () => {
  // Clocks go back on Nov 1 2026: that day is 25 hours long.
  const window = windowFromDays(whole("2026-10-31", "2026-11-01"));
  assert.ok("startsAt" in window);
  assert.equal(window.endsAt.valueOf() - window.startsAt.valueOf(), 49 * 3_600_000);
  assert.deepEqual(
    daysFromWindow(window.startsAt.toISOString(), window.endsAt.toISOString()),
    whole("2026-10-31", "2026-11-01"),
  );
});

test("part of a day keeps its times", () => {
  const days = { firstDay: "2026-09-12", lastDay: "2026-09-12", startTime: "14:00", endTime: "23:00" };
  const window = windowFromDays(days);
  assert.ok("startsAt" in window);
  assert.deepEqual(daysFromWindow(window.startsAt.toISOString(), window.endsAt.toISOString()), days);
});

test("impossible ranges are refused in words", () => {
  assert.deepEqual(windowFromDays(whole("2026-09-24", "2026-09-09")), {
    problem: "The last day can't be before the first.",
  });
  assert.deepEqual(windowFromDays(whole("", "2026-09-09")), {
    problem: "Choose the first day you're free.",
  });
  assert.deepEqual(
    windowFromDays({ firstDay: "2026-09-12", lastDay: "2026-09-12", startTime: "23:00", endTime: "14:00" }),
    { problem: "Choose an end time after the start time." },
  );
});

test("a window is described the way a person would say it", () => {
  const range = windowFromDays(whole("2026-09-09", "2026-09-24"));
  const day = windowFromDays(whole("2026-09-12", "2026-09-12"));
  const part = windowFromDays({ firstDay: "2026-09-12", lastDay: "2026-09-12", startTime: "14:00", endTime: "23:00" });
  assert.ok("startsAt" in range && "startsAt" in day && "startsAt" in part);
  const say = (w: { startsAt: Date; endsAt: Date }) =>
    describeAvailability(w.startsAt.toISOString(), w.endsAt.toISOString());
  assert.match(say(range), /^Sep 9(, 2026)? – Sep 24(, 2026)?$/);
  assert.match(say(day), /^Sat, Sep 12(, 2026)?$/);
  assert.match(say(part), /^Sat, Sep 12(, 2026)?, 2 PM – 11 PM$/);
});
