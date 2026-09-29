import assert from "node:assert/strict";
import test from "node:test";

import { separateGreeting, signWithStudio } from "../functions/src/ai/reply-format";

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

test("a reply that ends on a bare 'Warmly,' is signed with the studio's name", () => {
  // Production, 2026-09-29: the couple's first reply ended "Warmly," and then
  // the footer, because the prompt leaves the name to StudioCue.
  assert.equal(signWithStudio("Hi Harper,\n\nThank you.\n\nWarmly,", "FlawlessIQ"), "Hi Harper,\n\nThank you.\n\nWarmly,\nFlawlessIQ");
  assert.equal(signWithStudio("Thanks again.\n\nBest\n", "GR Productions"), "Thanks again.\n\nBest\nGR Productions");
});

test("a signed reply, or one with no sign-off, is left alone", () => {
  const signed = "Thank you.\n\nWarmly,\nGabe";
  assert.equal(signWithStudio(signed, "FlawlessIQ"), signed);
  assert.equal(signWithStudio("We'd love to talk.", "FlawlessIQ"), "We'd love to talk.");
  assert.equal(signWithStudio("Thank you.\n\nWarmly,", ""), "Thank you.\n\nWarmly,");
});

test("the couple's link still goes above the completed sign-off", () => {
  const signed = signWithStudio("Thank you.\n\nWarmly,", "FlawlessIQ");
  assert.match(signed, /\n\nWarmly,\nFlawlessIQ$/);
  // inquiry-link.ts's sign-off pattern takes the sign-off plus one line.
  assert.match(signed.trimEnd(), /\n\n((?:warmly)[^\n]*,?\s*(?:\n[^\n]*)?)$/i);
});
