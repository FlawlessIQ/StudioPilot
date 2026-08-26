import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasLetterhead,
  stripLetterhead,
} from "@/features/messaging/strip-letterhead";

test("the production case is cleaned", () => {
  const body = [
    "FlawlessIQ · Powered by StudioCue",
    "",
    "Your retainer invoice is ready",
    "",
    "Hi John Smith,",
    "FlawlessIQ created the invoice.",
  ].join("\n");
  assert.equal(
    stripLetterhead(body),
    [
      "Your retainer invoice is ready",
      "",
      "Hi John Smith,",
      "FlawlessIQ created the invoice.",
    ].join("\n"),
  );
  assert.equal(hasLetterhead(body), true);
});

test("a trailing footer is removed", () => {
  const body = "Hi John,\n\nSee you Saturday.\n\nSent securely via StudioCue.";
  assert.equal(stripLetterhead(body), "Hi John,\n\nSee you Saturday.");
});

test("a clean body is returned byte-for-byte", () => {
  const body = "Hi John,\n\nYou can pay here: https://example.test/x\n\n— FlawlessIQ";
  assert.equal(stripLetterhead(body), body);
  assert.equal(hasLetterhead(body), false);
});

test("a studio signature is not mistaken for chrome", () => {
  // "— FlawlessIQ" is the studio signing off, not a letterhead.
  const body = "Hi John,\n\nAll set.\n\n— FlawlessIQ";
  assert.equal(stripLetterhead(body), body);
});

test("a body that is only chrome is left alone rather than emptied", () => {
  // If stripping would consume everything, the assumption was wrong.
  const body = "FlawlessIQ · Powered by StudioCue";
  assert.equal(stripLetterhead(body), body);
});

test("a client's own words mentioning StudioCue are preserved", () => {
  const body = "Hi,\n\nIs this StudioCue thing where I pay?\n\nJohn";
  assert.equal(stripLetterhead(body), body);
});

test("non-strings and empties are safe", () => {
  assert.equal(stripLetterhead(null), "");
  assert.equal(stripLetterhead(undefined), "");
  assert.equal(stripLetterhead(""), "");
  assert.equal(hasLetterhead(null), false);
  assert.equal(hasLetterhead(""), false);
});
