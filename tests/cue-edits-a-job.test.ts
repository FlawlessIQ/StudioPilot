import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Cue could say where the Edit job control was and not use it. A rename is
 * exactly the small, reversible act the approval card exists for — the
 * product's own rule is "AI prepares, human approves", and this is the
 * preparing half it was missing.
 */
const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");
const copilot = source("functions/src/ai/copilot.ts");
const runner = source("lib/ai-actions/proposed-command-runner.ts");

const branch = copilot.slice(
  copilot.indexOf('} else if (proposal.commandType === "update_project") {'),
  copilot.indexOf('} else if (proposal.commandType === "set_insurance_required") {'),
);

test("the card is offered at all", () => {
  assert.match(copilot, /"update_project",/);
  assert.ok(branch.length > 0, "update_project branch not found");
  assert.match(branch, /op: "updateProject"/);
  assert.match(runner, /command\.domain === "crm"/);
});

/**
 * `updateProject` takes every descriptive field at once, so a partial write
 * would clear the rest by omission.
 */
test("the unchanged fields come from the record, not the model", () => {
  assert.match(branch, /const current = \{/);
  for (const field of ["name", "eventDate", "eventType", "venueName", "city", "timezone"])
    assert.ok(branch.includes(`${field}:`), field);
  assert.match(branch, /\.\.\.current, \[field\]: value/);
});

test("only a job's descriptive fields can be named", () => {
  assert.match(
    copilot,
    /z\s*\n?\s*\.enum\(\["name", "eventDate", "eventType", "venueName", "city", "timezone"\]\)/,
  );
  // Not the stage, not readiness, not the package.
  for (const forbidden of ['"state"', '"readinessScore"', '"packageSnapshotId"'])
    assert.ok(!branch.includes(forbidden), forbidden);
});

test("a card is not offered when it would fail or change nothing", () => {
  // Archived jobs refuse on approval; do not offer the card either.
  assert.match(branch, /projectDoc\.get\("archivedAt"\)\) continue;/);
  // A malformed date would be rejected by the command.
  assert.match(branch, /field === "eventDate" && !ISO_DATE\.test\(value\)\) continue;/);
  // And nothing to approve when the record already says this.
  assert.match(branch, /String\(was \?\? ""\) === value\) continue;/);
  assert.match(branch, /tenantId"\) !== tenantId\) continue;/);
});

/** The before and after is the whole reason this card exists. */
test("the card shows what changes", () => {
  assert.match(branch, /detail = `\$\{was \? String\(was\) : "Not set"\} → \$\{value\}`/);
});

test("the model never authors an identifier", () => {
  // It supplies a field name and a value; the project id comes from the
  // overview and every other value is read from the record.
  assert.ok(!/input: \{[^}]*proposal\.(title|detail|dueDate)/.test(branch));
  assert.match(branch, /projectId: proposal\.projectId/);
});
