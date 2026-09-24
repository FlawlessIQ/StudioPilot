import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * StudioCue was write-once for everything but a client.
 *
 * A job's name, date, venue and type were fixed at creation, with no control
 * anywhere in the app to change them — while `firestore.rules` had allowed a
 * browser to update a project the whole time. The reference studio found the
 * cost in an afternoon: a deliberately mistyped client email he could not
 * correct, a proposal sent four times to an address nobody reads, and the
 * product telling him to "open the project details page", which had no such
 * control.
 *
 * Structural, for the same reason as command-project-assignment.test.ts:
 * `functions/` is a separate package the root suite cannot import.
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const commands = source("functions/src/crm/commands.ts");
const form = source("components/projects/project-edit.tsx");
const detail = source("components/projects/live-project-detail.tsx");

test("a job can be corrected at all", () => {
  assert.match(commands, /type: z\.literal\("updateProject"\)/);
  assert.match(commands, /if \(command\.type === "updateProject"\)/);
  assert.match(form, /runCrmCommand\("updateProject"/);
  assert.match(detail, /<ProjectEdit/);
});

test("the edit is scoped to the job's own descriptive fields", () => {
  const block = commands.slice(
    commands.indexOf('if (command.type === "updateProject")'),
    commands.indexOf('if (command.type === "archiveProject")'),
  );
  for (const field of ["name", "eventDate", "eventType", "venueName", "city", "timezone"])
    assert.ok(block.includes(`${field}: command.input.${field}`), field);
  /**
   * `state` is a deterministic transition with its own evidence-controlled
   * path, and the derived fields are not a form's to clear by omission.
   */
  for (const forbidden of ["state:", "packageSnapshotId:", "readinessScore:", "stateVersion:"])
    assert.ok(!block.includes(`${forbidden} command.input`), forbidden);
});

test("editing is refused where acting is refused", () => {
  const block = commands.slice(
    commands.indexOf('if (command.type === "updateProject")'),
    commands.indexOf('if (command.type === "archiveProject")'),
  );
  // A tenant that is not yours, a project you were not assigned, an archived job.
  assert.match(block, /tenantId"\) !== command\.tenantId/);
  assert.match(block, /hasProjectAccess\(/);
  assert.match(block, /PROJECT_ARCHIVED/);
  // And the button is not offered on one either.
  assert.match(form, /if \(project\.archived\) return null;/);
});

/**
 * "The date moved" is the question someone asks weeks later when a dated
 * automation fired at the wrong time. An audit recording only the new value
 * cannot answer it.
 */
test("both sides of the change are audited", () => {
  const block = commands.slice(
    commands.indexOf('if (command.type === "updateProject")'),
    commands.indexOf('if (command.type === "archiveProject")'),
  );
  assert.match(block, /action: "project\.updated"/);
  assert.match(block, /payload: \{\s*\n?\s*before,/);
});

/**
 * `readinessOnProjectPlanning` only fires when a project's STATE changes into
 * PLANNING, so editing the date alone would leave readiness answering for the
 * old one.
 */
test("a moved date re-derives readiness, and a failure there is not a failed edit", () => {
  assert.match(commands, /eventDateChanged: before\.eventDate !== command\.input\.eventDate/);
  assert.match(commands, /reconcileProjectReadiness\(/);
  const hook = commands.slice(commands.indexOf("eventDateChanged\n") - 400);
  assert.match(commands, /catch \(caught: unknown\) \{\s*\n\s*console\.warn\(\s*\n?\s*`\[crm\] readiness reconcile/);
  assert.ok(hook.length > 0);
});

test("a refusal reads as a refusal, not a server fault", () => {
  assert.match(commands, /code === "FORBIDDEN" \|\| code === "PROJECT_ACCESS_DENIED"\s*\n?\s*\? 403/);
});

/** Every coded refusal needs words a studio can act on. */
test("the archived refusal has copy", () => {
  assert.match(source("lib/ai/friendly-error.ts"), /PROJECT_ARCHIVED:/);
});

/**
 * "Wedding photography" was printed under every job, including the video-led
 * ones — the same mislabel as the proposal PDF's hardcoded header.
 */
test("the job header no longer calls every job photography", () => {
  assert.ok(!detail.includes("{String(project.eventType)} photography"));
});
