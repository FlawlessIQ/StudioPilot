import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { taskIsSettled, taskStatusSchema } from "../features/tasks/schema";

/**
 * One vocabulary for a task's status, and one predicate for "finished".
 *
 * `completeTask` writes `complete`; the booking orchestrator and `sendAgreement`
 * — which close the "Prepare client agreement" task as a side effect — wrote
 * `completed`, a value taskStatusSchema does not contain. Two readers had
 * grown a hand-written ["complete", "completed", "cancelled"] to cope. The
 * third had not, so on the live tasks list a task the orchestrator had already
 * closed read "Prepare client agreement · completed · Mark done" and went on
 * offering to close it. Found by reading the production list.
 */

test("the schema's word for a finished task is `complete`", () => {
  assert.deepEqual(taskStatusSchema.options, [
    "not_started",
    "in_progress",
    "waiting",
    "complete",
    "cancelled",
  ]);
});

test("settled covers cancelled and both spellings of complete", () => {
  assert.equal(taskIsSettled("complete"), true);
  assert.equal(taskIsSettled("cancelled"), true);
  // Written by two server paths before the spelling was fixed; those rows are
  // still in Firestore, and a reader that forgets them puts the button back.
  assert.equal(taskIsSettled("completed"), true);
  for (const open of ["not_started", "in_progress", "waiting", "", null]) {
    assert.equal(taskIsSettled(open), false, `${String(open)} is not settled`);
  }
});

/**
 * Nothing writes a status the schema does not allow. Source-level because the
 * writers are inside Firestore transactions with no seam to call, and the
 * defect was precisely a literal that never met the enum.
 */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

/**
 * The object literal a `tasks/...` reference is written with — brace-matched,
 * so the scan stops at the write and does not bleed into the next one. The
 * first draft used a fixed window and flagged the `actionReceipts` write that
 * follows the task write in the booking orchestrator, which is legitimately
 * "completed". A test that cries wolf on correct code gets deleted.
 */
function taskWriteLiterals(source: string): string[] {
  const literals: string[] = [];
  for (const match of source.matchAll(/`tasks\/[^`]*`/g)) {
    const open = source.indexOf("{", (match.index ?? 0) + match[0].length);
    if (open === -1) continue;
    let depth = 0;
    for (let at = open; at < source.length; at += 1) {
      if (source[at] === "{") depth += 1;
      else if (source[at] === "}") {
        depth -= 1;
        if (depth === 0) {
          literals.push(source.slice(open, at + 1));
          break;
        }
      }
    }
  }
  return literals;
}

test("every task status written by a command is in the schema", () => {
  const allowed = new Set<string>(taskStatusSchema.options);
  const offenders: string[] = [];
  for (const file of sourceFiles(`${process.cwd()}/functions/src`)) {
    const source = readFileSync(file, "utf8");
    for (const literal of taskWriteLiterals(source)) {
      for (const [, value] of literal.matchAll(/status:\s*"([a-z_]+)"/g)) {
        if (allowed.has(value)) continue;
        offenders.push(
          `${file.replace(process.cwd() + "/", "")}: "${value}"`,
        );
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A task was written with a status taskStatusSchema does not contain. The readers then disagree about whether it is finished — which is how "completed \u00b7 Mark done" reached a production list.

${offenders.join("\n")}`,
  );
});

/** No reader re-invents the list the predicate exists to hold. */
test("no surface hand-writes the settled-status list", () => {
  const roots = ["components", "features", "lib", "app"];
  const offenders: string[] = [];
  for (const root of roots) {
    for (const file of sourceFiles(`${process.cwd()}/${root}`).concat(
      sourceFiles(`${process.cwd()}/${root}`).filter((f) => f.endsWith(".tsx")),
    )) {
      const source = readFileSync(file, "utf8");
      // The predicate itself is where the list is allowed to live.
      if (file.endsWith("features/tasks/schema.ts")) continue;
      if (/\["complete",\s*"completed",\s*"cancelled"\]/.test(source))
        offenders.push(file.replace(process.cwd() + "/", ""));
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    "Use taskIsSettled from features/tasks/schema instead of a local list — the one that was never updated is the bug.",
  );
});
