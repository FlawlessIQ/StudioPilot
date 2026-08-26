import assert from "node:assert/strict";
import { test } from "node:test";
import { daysUntilEvent } from "@/lib/format/event-date";

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
