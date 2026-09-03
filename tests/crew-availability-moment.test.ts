import assert from "node:assert/strict";
import { test } from "node:test";
import { availabilityNeedsFutureWindows } from "@/features/crew/availability-moment";

/**
 * The rule this file holds: the page for getting more work asks for some when
 * there is none marked ahead.
 */

const now = new Date("2026-09-03T12:00:00.000Z");

test("no windows at all — ask", () => {
  assert.equal(availabilityNeedsFutureWindows([], now), true);
});

test("every window in the past — ask", () => {
  // Jordan's actual page: one window, ended 16 August, walked on 3 September.
  assert.equal(
    availabilityNeedsFutureWindows(["2026-08-16T04:00:00.000Z"], now),
    true,
  );
});

test("one future window is enough — do not nag", () => {
  assert.equal(
    availabilityNeedsFutureWindows(
      ["2026-08-16T04:00:00.000Z", "2026-11-14T22:00:00.000Z"],
      now,
    ),
    false,
  );
});

test("an unreadable end is not a future window", () => {
  assert.equal(availabilityNeedsFutureWindows(["", "whenever"], now), true);
});
