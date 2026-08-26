import assert from "node:assert/strict";
import { test } from "node:test";
import {
  expiryNeedsReanchoring,
  expiryOnSend,
} from "@/features/booking/proposal-expiry";

const sentAt = new Date("2026-08-26T12:00:00.000Z");

test("a stale draft's window restarts at send", () => {
  // The production case: drafted Aug 20, expiring Aug 28, never sent.
  const result = expiryOnSend("2026-08-28T23:59:59.000Z", sentAt);
  assert.equal(result, new Date("2026-09-02T12:00:00.000Z").toISOString());
});

test("an already-expired draft still gets a full window", () => {
  const result = expiryOnSend("2026-08-01T23:59:59.000Z", sentAt);
  assert.equal(new Date(result) > sentAt, true);
  assert.equal(result, new Date("2026-09-02T12:00:00.000Z").toISOString());
});

test("a deliberately longer window is preserved, not shortened", () => {
  const chosen = "2026-12-31T23:59:59.000Z";
  assert.equal(expiryOnSend(chosen, sentAt), new Date(chosen).toISOString());
});

test("a missing or unusable expiry gets the minimum window", () => {
  for (const value of [null, undefined, "", "   ", "not-a-date", 42]) {
    assert.equal(
      expiryOnSend(value, sentAt),
      new Date("2026-09-02T12:00:00.000Z").toISOString(),
      `failed for ${JSON.stringify(value)}`,
    );
  }
});

test("the minimum window is configurable", () => {
  assert.equal(
    expiryOnSend("2026-08-27T00:00:00.000Z", sentAt, 14),
    new Date("2026-09-09T12:00:00.000Z").toISOString(),
  );
});

test("re-anchoring is reported only when the value actually moves", () => {
  assert.equal(expiryNeedsReanchoring("2026-08-28T23:59:59.000Z", sentAt), true);
  assert.equal(expiryNeedsReanchoring("2026-12-31T23:59:59.000Z", sentAt), false);
});
