import assert from "node:assert/strict";
import test from "node:test";

import { separateGreeting } from "../functions/src/ai/reply-format";

/**
 * A drafted reply's greeting on its own line. A production draft began
 * "Dear Dana,Thank you for reaching out…", and approving a reply emails it
 * verbatim.
 */

test("a greeting run into the first sentence gets its own line", () => {
  assert.equal(
    separateGreeting("Dear Dana,Thank you for reaching out to us."),
    "Dear Dana,\n\nThank you for reaching out to us.",
  );
  assert.equal(separateGreeting("Hi Emma, Thank you!"), "Hi Emma,\n\nThank you!");
  assert.equal(separateGreeting("Hello Sam and Jo,We loved it."), "Hello Sam and Jo,\n\nWe loved it.");
  assert.equal(separateGreeting("Good morning Priya,I hope"), "Good morning Priya,\n\nI hope");
});

test("a greeting already on its own line is left alone", () => {
  const body = "Dear Dana,\n\nThank you for reaching out.";
  assert.equal(separateGreeting(body), body);
  assert.equal(separateGreeting("Hi Emma,\nThanks!"), "Hi Emma,\nThanks!");
});

test("one sentence that happens to start with a greeting stays one sentence", () => {
  const body = "Hi Emma, congratulations on the engagement!";
  assert.equal(separateGreeting(body), body);
  assert.equal(separateGreeting("DEAR DANA, thank you"), "DEAR DANA, thank you");
});

test("bodies with no greeting are untouched", () => {
  for (const body of ["Thank you, Dana. We'd love to.", "", "Dearest friends,"]) {
    assert.equal(separateGreeting(body), body);
  }
});
