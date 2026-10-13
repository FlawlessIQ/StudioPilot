import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Conor, 2026-10-13: scheduling a call for a job squeezed the month into a
 * narrow column. The calendar sized its parts by position ("the first child
 * gets the month's share"), and the "Scheduling a … for" banner is the first
 * child whenever it shows. Sized by name now; the banner takes its own row.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the calendar's parts are sized by name, never by position", () => {
  for (const file of ["app/design-system.css", "app/legacy-bridge.css", "app/globals.css"]) {
    assert.doesNotMatch(read(file), /\.ds-cal\s*>\s*:(first-child|not\(:first-child\))/, file);
  }
  const css = read("app/design-system.css");
  assert.match(css, /\.ds-cal > \.ds-cal-context \{\s*flex: 1 1 100%;/);
  assert.match(css, /\.ds-cal > \.ds-cal-grid-card \{\s*flex: 1\.65 1 480px;/);
  assert.match(read("e2e/layout-integrity.spec.ts"), /"\/studio\/calendar\?project=demo-project"/);
});
