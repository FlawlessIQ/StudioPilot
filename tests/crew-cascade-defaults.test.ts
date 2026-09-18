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

test("the offered window is derived, not seeded once", () => {
  // Seeding state from `eventDate` captured the fallback (today) on the first
  // render, and the effect meant to correct it never did. Deriving means the
  // field is right the moment the job — or its run of show — arrives.
  assert.match(source, /const \[startsAtEdit, setStartsAtEdit\] = useState<string \| null>\(null\)/);
  assert.match(source, /const startsAt =\s*\n\s*startsAtEdit \?\?/);
  assert.match(source, /const endsAt =\s*\n\s*endsAtEdit \?\?/);
  // And the run of show wins over the plain event date when there is one.
  assert.match(source, /scheduledItems\[0\]/);
});

test("nothing writes the window back into state behind the studio", () => {
  assert.doesNotMatch(source, /setStartsAt\(/);
  assert.doesNotMatch(source, /setEndsAt\(/);
});
