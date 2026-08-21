import assert from "node:assert/strict";
import test from "node:test";
import { statusLabel } from "@/features/format/status-label";

test("system vocabulary becomes reader vocabulary", () => {
  assert.equal(statusLabel("review_required"), "Waiting on the studio");
  assert.equal(statusLabel("awaiting_signature"), "Waiting for signature");
  assert.equal(statusLabel("exhausted"), "Nobody accepted");
  assert.equal(statusLabel("viewed"), "Opened");
});

test("an unmapped status still reads as words, never as an enum", () => {
  // The long tail must never render worse than the raw value did.
  assert.equal(statusLabel("some_future_state"), "Some future state");
  assert.equal(statusLabel("queued"), "Queued");
  assert.ok(!statusLabel("some_future_state").includes("_"));
});

test("an absent status renders as nothing, not as \"undefined\"", () => {
  for (const value of [undefined, null, "", 42, {}]) {
    assert.equal(statusLabel(value), "");
  }
});
