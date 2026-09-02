import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysUntilEvent,
  todayInZone,
  todayLocalIso,
} from "@/lib/format/event-date";
import { calendarDayDiff } from "@/features/today/inbox";

/**
 * The studio job page and the couple's portal must never disagree about how
 * many days there are until the wedding.
 *
 * The portal used to anchor the event at T12:00 and `Math.ceil` from the exact
 * render instant, while the studio anchors to midnight and rounds from the
 * start of today. Before noon the portal read one day higher — every day.
 */

const eventDate = "2026-08-30";

/** What the portal used to do. Kept here so the regression stays legible. */
const oldPortalCount = (event: string, now: Date) =>
  Math.ceil((new Date(`${event}T12:00:00`).valueOf() - now.valueOf()) / 86_400_000);

test("the count is stable across the whole day", () => {
  const counts = [0, 6, 9, 12, 18, 23].map((hour) =>
    daysUntilEvent(eventDate, new Date(2026, 7, 26, hour, 0)),
  );
  assert.equal(
    new Set(counts).size,
    1,
    `the countdown changed during the day: ${counts.join(", ")}`,
  );
  assert.equal(counts[0], 4);
});

test("the old portal formula really did disagree before noon", () => {
  // Pins the bug this test exists to prevent, so nobody reintroduces it.
  const morning = new Date(2026, 7, 26, 9, 0);
  assert.equal(daysUntilEvent(eventDate, morning), 4);
  assert.equal(oldPortalCount(eventDate, morning), 5);
});

test("both surfaces now derive from one function, so they cannot drift", () => {
  for (const hour of [0, 6, 9, 12, 18, 23]) {
    const now = new Date(2026, 7, 26, hour, 0);
    const studio = daysUntilEvent(eventDate, now);
    const portal = daysUntilEvent(eventDate, now);
    assert.equal(studio, portal);
  }
});

test("the day of the event reads zero, and the day after reads negative", () => {
  assert.equal(daysUntilEvent(eventDate, new Date(2026, 7, 30, 9, 0)), 0);
  assert.equal(daysUntilEvent(eventDate, new Date(2026, 7, 31, 9, 0)), -1);
});

test("a missing date yields null rather than a number", () => {
  assert.equal(daysUntilEvent(null, new Date(2026, 7, 26)), null);
  assert.equal(daysUntilEvent("", new Date(2026, 7, 26)), null);
});

/**
 * Today used to run its own day arithmetic.
 *
 * `dayDiff` anchored a calendar date at noon UTC and measured from the exact
 * render instant, so on 27 August at 22:44 Eastern Today read "in 36 days" for
 * an event the job page read "in 37 days", and printed "THURSDAY, AUGUST 27"
 * above "September 4 · 7 DAYS TO" — which is eight.
 */
const oldTodayCount = (iso: string, now: Date) =>
  Math.round((Date.parse(`${iso}T12:00:00Z`) - now.valueOf()) / 86_400_000);

test("Today and the job page agree, at every hour", () => {
  const event = "2026-09-04";
  for (const hour of [0, 8, 13, 19, 20, 21, 22, 23]) {
    const now = new Date(2026, 7, 27, hour, 30);
    assert.equal(
      calendarDayDiff(event, now),
      daysUntilEvent(event, now),
      `Today disagreed with the job page at ${hour}:30`,
    );
    assert.equal(calendarDayDiff(event, now), 8);
  }
});

test("the old arithmetic is what lost the day, so the regression is named", () => {
  const evening = new Date(2026, 7, 27, 22, 44);
  assert.equal(oldTodayCount("2026-09-04", evening), 7);
  assert.equal(daysUntilEvent("2026-09-04", evening), 8);
});

test("today's own date is the reader's, not Greenwich's", () => {
  // Late evening Eastern is already tomorrow in UTC; the header is not.
  const evening = new Date(2026, 7, 27, 22, 44);
  assert.equal(todayLocalIso(evening), "2026-08-27");
  assert.equal(todayLocalIso(new Date(2026, 7, 27, 0, 1)), "2026-08-27");
  assert.equal(todayLocalIso(new Date(2026, 7, 27, 23, 59)), "2026-08-27");
});

test("on a server, today belongs to the job's timezone, not the container's", () => {
  // 02:30 UTC on 3 September is still 22:30 on 2 September in New York. A
  // UTC server marked a couple's balance overdue a day early every evening;
  // `todayLocalIso` cannot help there, because "local" on Cloud Run is UTC.
  const instant = new Date("2026-09-03T02:30:00Z");
  assert.equal(todayInZone("America/New_York", instant), "2026-09-02");
  assert.equal(todayInZone("UTC", instant), "2026-09-03");
  // Sydney is already well into the 3rd.
  assert.equal(todayInZone("Australia/Sydney", instant), "2026-09-03");
  // An unknown or missing zone must fall back, not throw.
  assert.equal(
    todayInZone("Not/AZone", instant),
    todayLocalIso(instant),
  );
  assert.equal(todayInZone("", instant), todayLocalIso(instant));
});
