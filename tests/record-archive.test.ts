import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARCHIVE_REFUSALS,
  archiveCopy,
} from "@/features/records/archive";

test("archiving asks before it acts, restoring does not", () => {
  // Archiving changes what the studio sees day to day; restoring only puts
  // something back, so a confirmation there is friction for its own sake.
  for (const kind of ["client", "vendor", "crew"] as const) {
    assert.ok(archiveCopy(kind, false).confirm, `${kind} archive must confirm`);
    assert.equal(archiveCopy(kind, true).confirm, null, `${kind} restore`);
  }
});

test("every kind promises that nothing is deleted", () => {
  // The word "delete" is what a studio reaches for, and it is the one thing
  // this does not do.
  for (const kind of ["client", "vendor", "crew"] as const) {
    assert.match(archiveCopy(kind, false).kept, /kept/);
  }
});

test("the crew wording is about the directory, not the person", () => {
  assert.match(archiveCopy("crew", false).label, /directory/i);
  assert.match(archiveCopy("crew", true).label, /directory/i);
});

test("each server refusal names the thing to do first", () => {
  for (const [code, message] of Object.entries(ARCHIVE_REFUSALS)) {
    assert.ok(message.length > 25, `${code} needs a real sentence`);
    assert.doesNotMatch(message, /[A-Z_]{6,}/, `${code} leaks a raw code`);
  }
  assert.match(ARCHIVE_REFUSALS.CONTACT_HAS_LIVE_PROJECT ?? "", /live/);
  assert.match(ARCHIVE_REFUSALS.CREW_HAS_OPEN_ASSIGNMENT ?? "", /assignment/);
});
