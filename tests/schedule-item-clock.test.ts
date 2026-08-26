import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayableScheduleItems,
  scheduleItemClock,
} from "../features/schedules/item-clock.ts";

/**
 * The client portal printed the literal string "Invalid Date" six times on an
 * approved schedule three days before a wedding, because the stored items
 * carried `{time, label}` while the reader expected `startAt`/`endAt`.
 */

test("a well-formed item formats its start and end", () => {
  const clock = scheduleItemClock(
    { startAt: "2026-08-29T17:00:00Z", endAt: "2026-08-29T17:30:00Z" },
    "UTC",
  );
  assert.equal(clock?.start, "5:00 PM");
  assert.equal(clock?.end, "5:30 PM");
});

test("an item with no startAt yields null rather than Invalid Date", () => {
  // This is the exact stored shape that broke the page.
  assert.equal(scheduleItemClock({ time: "13:00", label: "Getting ready" }), null);
});

test("null is returned for every unusable start, never a formatted string", () => {
  for (const startAt of [undefined, null, "", "   ", "not-a-date", 42, {}]) {
    assert.equal(
      scheduleItemClock({ startAt } as Record<string, unknown>),
      null,
      `${JSON.stringify(startAt)} should be unusable`,
    );
  }
});

test("a missing end does not disqualify an item — a start is enough to attend", () => {
  const clock = scheduleItemClock({ startAt: "2026-08-29T17:00:00Z" }, "UTC");
  assert.equal(clock?.start, "5:00 PM");
  assert.equal(clock?.end, null);
});

test("an unknown timezone falls back instead of throwing", () => {
  // Intl throws on a bad IANA zone; a formatting concern must not take the page
  // down on the morning of a wedding.
  assert.doesNotThrow(() =>
    scheduleItemClock({ startAt: "2026-08-29T17:00:00Z" }, "Mars/Olympus"),
  );
  assert.ok(scheduleItemClock({ startAt: "2026-08-29T17:00:00Z" }, "Mars/Olympus"));
});

test("displayable items drop the unusable ones and sort by start", () => {
  const items = [
    { id: "c", startAt: "2026-08-29T19:00:00Z" },
    { id: "broken", time: "13:00", label: "Getting ready" },
    { id: "a", startAt: "2026-08-29T13:00:00Z" },
    { id: "b", startAt: "2026-08-29T17:00:00Z" },
  ];
  assert.deepEqual(
    displayableScheduleItems(items).map((item) => item.id),
    ["a", "b", "c"],
  );
});

test("a schedule of entirely unusable items displays nothing at all", () => {
  // The caller then renders an honest empty state instead of six broken clocks.
  const stored = [
    { time: "13:00", label: "Getting ready — bridal suite" },
    { time: "16:30", label: "Ceremony" },
  ];
  assert.deepEqual(displayableScheduleItems(stored), []);
});

test("the input array is not mutated", () => {
  const items = [
    { id: "b", startAt: "2026-08-29T17:00:00Z" },
    { id: "a", startAt: "2026-08-29T13:00:00Z" },
  ];
  displayableScheduleItems(items);
  assert.deepEqual(items.map((i) => i.id), ["b", "a"]);
});
