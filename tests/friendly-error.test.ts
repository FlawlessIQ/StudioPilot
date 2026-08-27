import assert from "node:assert/strict";
import test from "node:test";
import { friendlyAiError, friendlyError } from "../lib/ai/friendly-error.ts";

test("known short codes map to plain copy", () => {
  assert.match(friendlyError(new Error("AI_QUOTA_EXCEEDED")), /included AI drafts/);
  assert.match(friendlyError(new Error("FORBIDDEN")), /don't have permission/);
});

test("infrastructure prose is replaced, not passed through", () => {
  // This message reads as prose, so it slipped past the human-written check
  // and printed a list of missing Firebase config keys to the photographer.
  const raw = new Error(
    "Firebase client configuration is incomplete: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId",
  );
  const friendly = friendlyError(raw);
  assert.doesNotMatch(friendly, /apiKey|storageBucket|Firebase/);
  assert.match(friendly, /isn't fully configured/);
});

test("permission and network failures read calmly", () => {
  assert.match(
    friendlyError(new Error("Missing or insufficient permissions.")),
    /don't have access/,
  );
  assert.match(friendlyError(new Error("Failed to fetch")), /couldn't reach the server/);
});

test("human-authored copy still passes through untouched", () => {
  const copy = "Coverage must end after it starts.";
  assert.equal(friendlyError(new Error(copy)), copy);
});

test("dumps and codes collapse to the fallback", () => {
  assert.equal(
    friendlyError(new Error('{"issues":[{"path":["startAt"]}]}'), "Nope."),
    "Nope.",
  );
  assert.equal(friendlyError(new Error("SOME_UNMAPPED_CODE"), "Nope."), "Nope.");
});

test("the AI-specific entry point keeps its own default", () => {
  assert.match(friendlyAiError(new Error("SOME_UNMAPPED_CODE")), /couldn't draft this/);
});

test("a refused booking attestation says what the obstacle is", () => {
  // The walk of 2026-08-26 hit this and read only "The payment could not be
  // recorded." The code carries the whole answer, so the map must too.
  assert.match(
    friendlyError(
      new Error("RETAINER_INVOICE_ALREADY_EXISTS"),
      "The payment could not be recorded.",
    ),
    /already settled/,
  );
  assert.match(
    friendlyError(new Error("SIGNED_CONTRACT_REQUIRED"), "Nope."),
    /signed agreement comes first/,
  );
});

test("a refused delivery says which step is missing", () => {
  assert.match(
    friendlyError(
      new Error("PROJECT_NOT_IN_POST_PRODUCTION"),
      "Delivery could not be recorded.",
    ),
    /hasn't started post-production/,
  );
  assert.match(
    friendlyError(new Error("DELIVERY_URL_MUST_USE_HTTPS"), "Nope."),
    /https:\/\//,
  );
});
