import assert from "node:assert/strict";
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
