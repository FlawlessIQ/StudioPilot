import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

/**
 * Every command endpoint records that it ran, and records it inside the
 * transaction that did the work.
 *
 * The mechanism was verified by hand against the emulator on 2026-08-28:
 * `transitionProject` replayed with the same idempotency key returned the
 * identical prior result and left `stateVersion` at 1 rather than 2; and two
 * concurrent transitions declaring the same `expectedVersion` produced one
 * success and one VERSION_CONFLICT, with the version advancing exactly once.
 *
 * This test is what keeps that true. It is structural because `functions/` is
 * a separate package with its own build that the root suite cannot import —
 * the same reason tests/functions-relay-allowlist.test.ts reads source.
 */

const source = (path: string) => readFileSync(`${process.cwd()}/${path}`, "utf8");

const COMMAND_ENDPOINTS = [
  "functions/src/crm/commands.ts",
  "functions/src/booking/commands.ts",
  "functions/src/planning/commands.ts",
  "functions/src/workflow/commands.ts",
  "functions/src/crew/commands.ts",
  "functions/src/post-event/commands.ts",
  "functions/src/communications/commands.ts",
  "functions/src/integrations/commands.ts",
  "functions/src/studio-import/commands.ts",
];

test("every command endpoint takes an idempotency key", () => {
  for (const file of COMMAND_ENDPOINTS) {
    assert.match(
      source(file),
      /idempotencyKey:\s*z\.string\(\)/,
      `${file} accepts commands with no idempotency key`,
    );
  }
});

test("every command endpoint writes a commandExecutions receipt", () => {
  for (const file of COMMAND_ENDPOINTS) {
    assert.match(
      source(file),
      /commandExecutions\//,
      `${file} has no idempotency receipt, so a retry runs the work twice`,
    );
  }
});

test("the receipt is keyed by tenant as well as by key", () => {
  // A bare idempotency key would let one studio's retry collide with another's,
  // and return the wrong tenant's result.
  for (const file of COMMAND_ENDPOINTS) {
    const text = source(file);
    const receipt = text.slice(
      text.indexOf("commandExecutions/") - 220,
      text.indexOf("commandExecutions/") + 160,
    );
    assert.match(
      receipt,
      /tenantId/,
      `${file} keys its receipt without the tenant`,
    );
  }
});

test("crmCommand creates its receipt rather than setting it", () => {
  /**
   * `create` fails if the document already exists; `set` overwrites. Inside a
   * transaction that difference is the last line of defence against two
   * concurrent requests carrying the same key both doing the work.
   */
  const text = source("functions/src/crm/commands.ts");
  assert.match(text, /transaction\.create\(commandReference/);
  assert.doesNotMatch(text, /transaction\.set\(commandReference/);
});

test("crmCommand re-checks the receipt inside the transaction", () => {
  // The check before the transaction is a fast path. The one inside it is what
  // makes a concurrent replay safe.
  const text = source("functions/src/crm/commands.ts");
  const transactionStart = text.indexOf("db.runTransaction");
  assert.notEqual(transactionStart, -1);
  const body = text.slice(transactionStart, transactionStart + 500);
  assert.match(body, /transaction\.get\(commandReference\)/);
});

test("every crmCommand branch records its own receipt", () => {
  const text = source("functions/src/crm/commands.ts");
  const branches = [...text.matchAll(/command\.type === "([a-zA-Z]+)"/g)].map(
    (match) => ({ type: match[1]!, at: match.index! }),
  );
  assert.ok(branches.length >= 8, "crmCommand branches are no longer detectable");
  for (const [index, branch] of branches.entries()) {
    const end = branches[index + 1]?.at ?? text.length;
    assert.match(
      text.slice(branch.at, end),
      /transaction\.create\(commandReference/,
      `${branch.type} does its work without recording a receipt, so a retry repeats it`,
    );
  }
});

test("state changes are guarded by an expected version", () => {
  // Optimistic concurrency: the caller declares the version it read, and a
  // racing writer is refused rather than silently overwriting.
  const text = source("functions/src/crm/commands.ts");
  assert.match(text, /expectedVersion/);
  assert.match(text, /VERSION_CONFLICT/);
  assert.match(
    source("lib/ai/friendly-error.ts"),
    /VERSION_CONFLICT/,
    "VERSION_CONFLICT would print as a raw code",
  );
});

test("provider webhooks are inserted once, under a provider-derived key", () => {
  for (const file of [
    "functions/src/booking/webhooks.ts",
    "functions/src/booking/zoom-webhook.ts",
    "functions/src/post-event/inbound.ts",
  ]) {
    assert.match(
      source(file),
      /webhookEvents\//,
      `${file} does not dedupe replayed provider events`,
    );
  }
});
