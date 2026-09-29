import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The fast half of the phone-width guard. The full check is
 * e2e/mobile-no-horizontal-overflow.spec.ts (every couple and crew route at
 * 360/390/430 px, in Chrome and Safari's engine); it needs a server, so these
 * pin the rules that caused the 2026-09-28 overflow on every `npm test`.
 */
const css = readFileSync(`${process.cwd()}/app/globals.css`, "utf8");

/** The ≤640px rule that paired fields into 156 px columns on an iPhone. */
test("the inquiry form is one field per row on a phone", () => {
  const rule = /\.inquiry-form \.form-grid \{[^}]*\}/g;
  for (const block of css.match(rule) ?? []) {
    assert.doesNotMatch(
      block,
      /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
      `paired columns are back:\n${block}`,
    );
  }
  assert.doesNotMatch(css, /\.inquiry-form \.form-grid > label:has\(> input\[name="firstName"\]\)/);
});

test("the inquiry column can shrink to the phone", () => {
  assert.match(css, /\.inquiry-layout \{\s*gap: 42px;[^}]*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.inquiry-form \{\s*min-width: 0;\s*\}/);
});

/** iOS will not shrink a native date input; dropping its appearance lets width apply. */
test("date and time inputs cannot widen a phone page", () => {
  const phone = css.slice(css.lastIndexOf("Phones: no input may make a page wider"));
  assert.match(phone, /@media \(max-width: 640px\)/);
  assert.match(phone, /max-width: 100%;\s*min-width: 0;/);
  assert.match(phone, /\[type="date"\], \[type="datetime-local"\], \[type="time"\]/);
  assert.match(phone, /-webkit-appearance: none;/);
});
