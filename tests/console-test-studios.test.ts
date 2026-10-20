import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isTeamEmail, isTestStudio } from "../features/console/test-studios";

test("a studio owned by a team address is a test studio", () => {
  assert.equal(isTestStudio({ ownerEmail: "conor@flawlessiq.com" }), true);
  assert.equal(isTestStudio({ ownerEmail: "Conor+coi@FlawlessIQ.com " }), true);
  assert.equal(isTeamEmail("someone@notflawlessiq.com"), false);
});

test("a real customer is not a test studio", () => {
  assert.equal(isTestStudio({ ownerEmail: "gabe@grproductions.com", tags: [] }), false);
  assert.equal(isTestStudio({ ownerEmail: null }), false);
});

test("a test tag marks any studio, and a real tag overrides the address", () => {
  assert.equal(isTestStudio({ ownerEmail: "hy@gmail.com", tags: ["Test"] }), true);
  assert.equal(isTestStudio({ ownerEmail: "conor@flawlessiq.com", tags: ["real"] }), false);
});

test("the daily metrics use the same rule as the Console", () => {
  const body = (path: string) => {
    const source = readFileSync(path, "utf8");
    return source.slice(source.indexOf("*/\n") + 3);
  };
  assert.equal(body("functions/src/console/test-studios.ts"), body("features/console/test-studios.ts"));
  assert.match(readFileSync("functions/src/console/rollup.ts", "utf8"), /filter\(\(studio\) => !isTestStudio\(studio\)\)/);
});
