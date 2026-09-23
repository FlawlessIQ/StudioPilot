import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Reading a studio's own words back into structured coverage.
 *
 * A package gains `includedCoverage` only when next saved, so a studio with
 * packages older than the roles model still carries one number —
 * `includedPhotographers` — whatever its description says. For the reference
 * studio that number is wrong in kind: five cinematic packages each record a
 * videographer as a photographer, which decides who is offered the job and what
 * the couple sees on a proposal.
 *
 * The derivation is prose-reading, so it is only ever a proposal a person
 * checks. These cases are the real descriptions, verbatim.
 */

const source = readFileSync("scripts/backfill-package-coverage.mjs", "utf8");

// The script is an ESM module that connects to Firestore on import, so the
// pure function is exercised through a copy of its own source rather than by
// importing it.
const deriveCoverage = new Function(
  `${source.slice(source.indexOf("const WORD ="), source.indexOf("const tenants ="))
    .replace("export function deriveCoverage", "function deriveCoverage")}
   return deriveCoverage;`,
)() as (description: string) => { coverage: { role: string; count: number }[]; evidence: string[] };

const cases: Array<[string, string, { role: string; count: number }[]]> = [
  [
    "Gold Cinematic",
    "One videographer for 10 hours, plus a second associate videographer for 7 hours with drone and gimbal.",
    [{ role: "videographer", count: 2 }],
  ],
  [
    "Gold Photo",
    "One photographer with up to 8 hours of coverage. Second photographer with up to 6 hours of coverage.",
    [{ role: "photographer", count: 2 }],
  ],
  [
    "Platinum Cinema",
    "Two videographers for a full day, 10 hours of coverage each.",
    [{ role: "videographer", count: 2 }],
  ],
  [
    "Platinum Photo",
    "Two photographers with up to 10 hours of coverage each.",
    [{ role: "photographer", count: 2 }],
  ],
  [
    "Silver Cinematic",
    "One videographer for 8 hours. Contemporary cinematic style of shooting and editing.",
    [{ role: "videographer", count: 1 }],
  ],
];

for (const [name, description, expected] of cases) {
  test(`${name} reads as ${JSON.stringify(expected)}`, () => {
    assert.deepEqual(deriveCoverage(description).coverage, expected);
  });
}

test("a description naming nobody proposes nothing", () => {
  // Better left for the studio than guessed at.
  assert.deepEqual(
    deriveCoverage("Unlimited photography. Post production for all images.").coverage,
    [],
  );
});

test("every proposal carries the words it was read from", () => {
  const { evidence } = deriveCoverage(
    "One videographer for 10 hours, plus a second associate videographer for 7 hours.",
  );
  assert.ok(evidence.length >= 2, "a person has to be able to check each row");
});

test("the script refuses to reprice and defaults to a dry run", () => {
  // Where the retainer is per-crew, coverage decides what a couple owes, and
  // no automated read of prose should move that.
  assert.match(source, /per_crew_member/);
  assert.match(source, /held back/);
  assert.match(source, /--apply/);
  assert.match(source, /DRY RUN/);
});
