import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ARCHIVE_REFUSALS,
  archiveCopy,
} from "@/features/records/archive";

test("archiving asks before it acts, restoring does not", () => {
  // Archiving changes what the studio sees day to day; restoring only puts
  // something back, so a confirmation there is friction for its own sake.
  for (const kind of ["client", "vendor", "crew", "job"] as const) {
    assert.ok(archiveCopy(kind, false).confirm, `${kind} archive must confirm`);
    assert.equal(archiveCopy(kind, true).confirm, null, `${kind} restore`);
  }
});

test("every kind promises that nothing is deleted", () => {
  // The word "delete" is what a studio reaches for, and it is the one thing
  // this does not do.
  for (const kind of ["client", "vendor", "crew", "job"] as const) {
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

/**
 * A job can be archived at all.
 *
 * The Jobs list has had an Archived tab since it was built, the job page
 * offered only "put on hold" and "cancel", and nothing anywhere could set
 * `archivedAt` on a project. The studio this product is validated against
 * asked "how do I delete/archive a job?" — reaching for "delete" for exactly
 * the reason this module's header describes, one entity over.
 */
test("a job is archivable, and the words point at cancel when it is off", () => {
  const copy = archiveCopy("job", false);
  assert.equal(copy.label, "Archive job");
  assert.match(
    copy.confirm ?? "",
    /cancel it instead/i,
    "archiving is bookkeeping; a wedding that is off should be cancelled, and the copy has to say so",
  );
  assert.equal(archiveCopy("job", true).label, "Restore job");
});

test("the job page offers it, beside hold and cancel", () => {
  const source = readFileSync(
    `${process.cwd()}/components/projects/live-project-detail.tsx`,
    "utf8",
  );
  assert.match(source, /kind="job"/);
  assert.match(source, /runCrmCommand\("archiveProject"/);
  // Beside the interruptions, because that is where someone looks for it.
  assert.ok(
    source.indexOf("ProjectArchiveControl") <
      source.indexOf("function ProjectInterruptionControl"),
    "the archive control should be declared with the interruption control",
  );
});

/** And the server actually accepts it. */
test("archiveProject exists as a command, and is reversible", () => {
  const source = readFileSync(
    `${process.cwd()}/functions/src/crm/commands.ts`,
    "utf8",
  );
  assert.match(source, /z\.literal\("archiveProject"\)/);
  assert.match(source, /archivedAt: command\.input\.restore \? null : timestamp/);
  // Curating the working list is an owner/admin decision, as for a client.
  const handler = source.slice(source.indexOf('command.type === "archiveProject"'));
  assert.match(
    handler.slice(0, 900),
    /\["studio_owner", "studio_admin"\]\.includes\(membershipData\.role\)/,
  );
  // Widened when archiving gained its live-crew refusal, which sits between
  // the role check and the audit event.
  assert.match(handler.slice(0, 3200), /action: command\.input\.restore\s*\n?\s*\? "project\.restored"/);
});
