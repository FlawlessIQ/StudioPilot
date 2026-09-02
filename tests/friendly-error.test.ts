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

test("a schema rejection names the field instead of saying Try again", () => {
  /**
   * `INVALID_COMMAND` is what all three command endpoints return for any
   * schema failure — the most-hit error in the product — and it had no entry
   * at all, so every one of them fell through to whichever generic fallback
   * the calling form passed. A retainer percentage of 1000 on the package a
   * new studio must create before its first proposal reported, in full,
   * "The package could not be created. Try again." — the one instruction
   * guaranteed to fail identically.
   */
  assert.match(
    friendlyError(new Error("INVALID_COMMAND:retainer percent")),
    /Check retainer percent/,
  );
  assert.doesNotMatch(
    friendlyError(new Error("INVALID_COMMAND:retainer percent")),
    /Try again/,
  );
  // Still answers when the server sent no detail.
  assert.match(
    friendlyError(new Error("INVALID_COMMAND")),
    /wasn't accepted|Check the values/,
  );
});

test("a dependency refusal names the step it waits on", () => {
  assert.match(
    friendlyError(new Error("DEPENDENCIES_INCOMPLETE:Questionnaire complete")),
    /Questionnaire complete/,
  );
  assert.match(
    friendlyError(new Error("DEPENDENCIES_INCOMPLETE")),
    /before this one/,
  );
});

test("a blocked closeout lists what is open", () => {
  // The reconciler checks eight requirements and reported a three-way guess.
  assert.match(
    friendlyError(
      new Error("CLOSEOUT_BLOCKED:Signed agreement, Final balance"),
    ),
    /Still open: Signed agreement, Final balance/,
  );
});

test("a detail containing a colon survives intact", () => {
  assert.match(
    friendlyError(new Error("INVALID_COMMAND:gallery url: must be https")),
    /gallery url: must be https/,
  );
});
