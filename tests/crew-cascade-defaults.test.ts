import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The crew cascade builder offered a wedding eight months out with today's
 * date on it, under copy reading "Times come from the current schedule".
 * `eventDate` falls back to today so the inputs are never empty, and the
 * defaults effect ran on the pass before the project's own date had loaded —
 * then marked itself hydrated, which blocks every later correction.
 */
const source = readFileSync(
  `${process.cwd()}/components/crew/crew-cascade-workspace.tsx`,
  "utf8",
);

test("defaults are never hydrated from the fallback date", () => {
  const effect = source.slice(
    source.indexOf("if (\n      defaultsHydrated ||"),
    source.indexOf("setDefaultsHydrated(true)"),
  );
  assert.match(effect, /if \(!text\(project\.eventDate\)\) return;/);
  // And the guard comes before anything is computed from the date.
  assert.ok(
    effect.indexOf("if (!text(project.eventDate)) return;") <
      effect.indexOf("const nextStart"),
  );
});
