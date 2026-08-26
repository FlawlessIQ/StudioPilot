import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifySessionFailure,
  greetingName,
} from "@/features/auth/session-failure";

test("a revoked token is a session that ended, and is not retryable", () => {
  // The exact string that reached the studio's error banner.
  const failure = classifySessionFailure(
    new Error("The Firebase ID token has been revoked."),
  );
  assert.equal(failure.kind, "session_ended");
  assert.equal(failure.retryable, false);
  assert.match(failure.message, /session has ended/i);
});

test("no provider vocabulary survives into the message", () => {
  const raws = [
    "The Firebase ID token has been revoked.",
    "auth/id-token-expired",
    "FIRESTORE (10.0.0) INTERNAL ASSERTION FAILED",
    "Missing or insufficient permissions.",
    "PERMISSION_DENIED: request failed",
  ];
  for (const raw of raws) {
    const { message } = classifySessionFailure(raw);
    assert.doesNotMatch(
      message,
      /firebase|firestore|token|auth\/|permission_denied/i,
      `leaked provider wording for: ${raw}`,
    );
  }
});

test("a permissions refusal is distinguished from an ended session", () => {
  const failure = classifySessionFailure("Missing or insufficient permissions.");
  assert.equal(failure.kind, "not_permitted");
  assert.equal(failure.retryable, false);
});

test("an unrecognised failure is treated as transient and offers retry", () => {
  const failure = classifySessionFailure(new Error("socket hang up"));
  assert.equal(failure.kind, "unavailable");
  assert.equal(failure.retryable, true);
});

test("empty and non-error inputs do not throw", () => {
  for (const raw of [null, undefined, 0, {}, [], ""]) {
    assert.equal(classifySessionFailure(raw).kind, "unavailable");
  }
});

test("the placeholder display name never becomes a greeting", () => {
  // "Good morning, Signed-in." was the observed output.
  assert.equal(greetingName("Signed-in user"), null);
  assert.equal(greetingName("signed-in"), null);
  assert.equal(greetingName("Unknown"), null);
  assert.equal(greetingName("Guest"), null);
  assert.equal(greetingName(""), null);
  assert.equal(greetingName("   "), null);
  assert.equal(greetingName(null), null);
});

test("a real name still yields its first name", () => {
  assert.equal(greetingName("Conor Lawless"), "Conor");
  assert.equal(greetingName("  Maren  Castillo "), "Maren");
  assert.equal(greetingName("Jordan"), "Jordan");
});
