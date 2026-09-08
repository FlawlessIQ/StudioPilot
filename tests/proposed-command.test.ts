import assert from "node:assert/strict";
import { test } from "node:test";
import {
  commandOf,
  isProposedStudioCommand,
  PROPOSED_COMMAND_ALLOWLIST,
} from "@/lib/ai-actions/proposed-command";

const studioCommand = (domain: string, op: string) => ({
  kind: "studio_command",
  label: "Do the thing",
  command: { domain, op, input: { projectId: "p1" } },
});

test("an allowlisted studio command is runnable", () => {
  for (const pair of PROPOSED_COMMAND_ALLOWLIST) {
    const [domain, op] = pair.split(":");
    assert.ok(domain && op);
    assert.equal(isProposedStudioCommand(studioCommand(domain, op)), true, pair);
    assert.deepEqual(commandOf(studioCommand(domain, op))?.op, op);
  }
});

test("a command NOT on the allowlist is never runnable", () => {
  // The whole point of the guard: a tampered or unexpected action can't execute
  // an arbitrary command just by carrying it.
  for (const pair of ["crm:transitionProject", "planning:publishSchedule", "billing:refund"]) {
    const [domain, op] = pair.split(":");
    assert.equal(isProposedStudioCommand(studioCommand(domain, op)), false, pair);
    assert.equal(commandOf(studioCommand(domain, op)), null);
  }
});

test("a non-studio-command output is not runnable", () => {
  // An email draft (or anything without kind studio_command) must not be treated
  // as a runnable command.
  assert.equal(isProposedStudioCommand({ subject: "Hi", body: "..." }), false);
  assert.equal(isProposedStudioCommand({ kind: "studio_command" }), false); // no command
  assert.equal(isProposedStudioCommand(null), false);
  assert.equal(isProposedStudioCommand({ kind: "studio_command", command: {} }), false);
});
