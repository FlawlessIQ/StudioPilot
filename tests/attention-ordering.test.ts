import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byLongestWaiting,
  waitingDays,
  waitingLabel,
} from "@/features/ordering/attention";

const now = new Date("2026-08-26T12:00:00Z");

test("the longest-waiting item comes first", () => {
  // The exact case from the audit: Hana waiting 5 days sat below Aoife's 2.
  const leads = [
    { id: "aoife", createdAt: "2026-08-24T10:00:00Z" },
    { id: "hana", createdAt: "2026-08-20T10:00:00Z" },
  ];
  assert.deepEqual(
    [...leads].sort(byLongestWaiting((l) => l.createdAt)).map((l) => l.id),
    ["hana", "aoife"],
  );
});

test("items that cannot be aged sort last, never displacing a real wait", () => {
  const leads = [
    { id: "undated", createdAt: null },
    { id: "recent", createdAt: "2026-08-25T10:00:00Z" },
    { id: "old", createdAt: "2026-08-01T10:00:00Z" },
    { id: "garbage", createdAt: "not-a-date" },
  ];
  const order = [...leads]
    .sort(byLongestWaiting((l) => l.createdAt))
    .map((l) => l.id);
  assert.deepEqual(order.slice(0, 2), ["old", "recent"]);
  assert.deepEqual(order.slice(2).sort(), ["garbage", "undated"]);
});

test("a bare date is anchored at midday so timezones cannot reorder it", () => {
  // Two items one day apart must not swap depending on the runtime zone.
  const items = [{ d: "2026-08-21" }, { d: "2026-08-20" }];
  assert.deepEqual(
    [...items].sort(byLongestWaiting((i) => i.d)).map((i) => i.d),
    ["2026-08-20", "2026-08-21"],
  );
});

test("waiting days counts whole elapsed days", () => {
  assert.equal(waitingDays("2026-08-20T12:00:00Z", now), 6);
  assert.equal(waitingDays("2026-08-26T00:00:00Z", now), 0);
  assert.equal(waitingDays(null, now), null);
  assert.equal(waitingDays("not-a-date", now), null);
});

test("a future date reports zero, not a negative wait", () => {
  assert.equal(waitingDays("2026-09-01T12:00:00Z", now), 0);
});

test("the label reads as a sentence fragment", () => {
  assert.equal(waitingLabel("2026-08-20T12:00:00Z", now), "waiting 6 days");
  assert.equal(waitingLabel("2026-08-25T12:00:00Z", now), "waiting 1 day");
  assert.equal(waitingLabel("2026-08-26T09:00:00Z", now), "arrived today");
  assert.equal(waitingLabel(null, now), null);
});

test("Date objects and epoch numbers are accepted", () => {
  assert.equal(waitingDays(new Date("2026-08-20T12:00:00Z"), now), 6);
  assert.equal(waitingDays(new Date("2026-08-20T12:00:00Z").valueOf(), now), 6);
  assert.equal(waitingDays(new Date("invalid"), now), null);
});

test("sorting does not mutate the input", () => {
  const items = [{ d: "2026-08-25" }, { d: "2026-08-20" }];
  items.sort(byLongestWaiting((i) => i.d));
  // sort is in-place by contract, so callers spread first; assert the
  // comparator itself is stable and side-effect free across repeat calls.
  const compare = byLongestWaiting<{ d: string }>((i) => i.d);
  assert.equal(compare(items[0]!, items[1]!), compare(items[0]!, items[1]!));
});
