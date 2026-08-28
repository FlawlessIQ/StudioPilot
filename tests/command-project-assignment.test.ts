import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * A coordinator holds a list of permitted project ids, and every project-scoped
 * command has to honour it.
 *
 * `firestore.rules` already does: `canManageProject` lets a coordinator update
 * only a project they are assigned to. `crmCommand` did not. Of its eight
 * command types exactly one checked assignment, so a `studio_coordinator` could
 * drive **any** project in the studio through its whole lifecycle with
 * `transitionProject`, and lock a package onto it with `selectPackage`,
 * regardless of what they had been given. The endpoint was more permissive than
 * the rules it is supposed to be stricter than.
 *
 * The other five command endpoints all had the gate already. This test is
 * structural rather than behavioural because `functions/` is a separate package
 * with its own build that the root test suite cannot import — the same reason
 * tests/functions-relay-allowlist.test.ts reads source.
 */

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

/** Command endpoints that act on a single project, and their gate. */
const GATED_ENDPOINTS: Array<{ file: string; gate: RegExp }> = [
  { file: "functions/src/crm/commands.ts", gate: /hasProjectAccess\(/ },
  { file: "functions/src/workflow/commands.ts", gate: /hasProjectAccess\(/ },
  { file: "functions/src/booking/commands.ts", gate: /projectIds\.includes\(/ },
  { file: "functions/src/planning/commands.ts", gate: /projectIds\.includes\(/ },
  { file: "functions/src/post-event/commands.ts", gate: /projectIds\.includes\(/ },
  {
    file: "functions/src/communications/commands.ts",
    gate: /projectIds["\s\S]{0,80}\.includes\(/,
  },
];

test("every project-scoped command endpoint has an assignment gate", () => {
  for (const { file, gate } of GATED_ENDPOINTS) {
    assert.match(source(file), gate, `${file} has no project-assignment check`);
  }
});

/**
 * The command types in crmCommand that name a projectId in their input, and so
 * must pass through the gate. Listed explicitly: a new project-scoped command
 * added without a gate should fail this test rather than inherit silence.
 */
const CRM_PROJECT_COMMANDS = [
  "transitionProject",
  "selectPackage",
  "associateClientProject",
];

test("each project-scoped crmCommand branch checks assignment", () => {
  const text = source("functions/src/crm/commands.ts");
  for (const type of CRM_PROJECT_COMMANDS) {
    const start = text.indexOf(`command.type === "${type}"`);
    assert.notEqual(start, -1, `${type} is no longer in crmCommand`);
    // The branch runs until the next `command.type ===` comparison.
    const next = text.indexOf('command.type === "', start + 20);
    const branch = text.slice(start, next === -1 ? undefined : next);
    assert.match(
      branch,
      /hasProjectAccess\(membershipData, /,
      `${type} does not check project assignment`,
    );
  }
});

test("the gate lets owners and admins act tenant-wide", () => {
  // A coordinator is the only role the list narrows; over-restricting owners
  // would break every studio of one person with no explicit assignments.
  const text = source("functions/src/crm/commands.ts");
  assert.match(text, /const managerRoles = \["studio_owner", "studio_admin"\]/);
  assert.match(text, /managerRoles\.includes\(membership\.role\)/);
});

test("the refusal has a code a photographer can be shown", () => {
  const text = source("functions/src/crm/commands.ts");
  assert.match(text, /PROJECT_NOT_PERMITTED/);
  assert.match(
    source("lib/ai/friendly-error.ts"),
    /PROJECT_NOT_PERMITTED/,
    "PROJECT_NOT_PERMITTED has no friendly message, so it prints as a raw code",
  );
});
