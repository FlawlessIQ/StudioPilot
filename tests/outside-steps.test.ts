import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  OUTSIDE_STEPS,
  OUTSIDE_STEP_IDS,
  outsideStepStatus,
} from "../features/outside-steps/registry";

test("every outside step says what, why, where, who, what it unlocks, and how", () => {
  for (const id of OUTSIDE_STEP_IDS) {
    const step = OUTSIDE_STEPS[id];
    assert.equal(step.id, id);
    for (const field of ["title", "where", "why", "who", "unlocks"] as const)
      assert.ok(step[field].length > 3, `${id}.${field}`);
    assert.ok(step.instructions.length >= 2, `${id} has steps`);
  }
});

test("the functions accept exactly the steps the app knows", () => {
  const command = readFileSync("functions/src/integrations/commands.ts", "utf8");
  const match = command.match(/stepId: z\.enum\(\[([^\]]+)\]\)/);
  assert.ok(match, "setOutsideStep declares its step ids");
  const ids = [...match[1].matchAll(/"([a-z_]+)"/g)].map((part) => part[1]).sort();
  assert.deepEqual(ids, [...OUTSIDE_STEP_IDS].sort());
});

test("applying for QuickBooks Payments: told, then seen", () => {
  const apply = (signals: Parameters<typeof outsideStepStatus>[1]) =>
    outsideStepStatus("quickbooks_payments_apply", signals);
  assert.equal(apply({}).state, "not_started");
  assert.equal(apply({ record: { state: "waiting", at: "2026-09-28T10:00:00Z" } }).state, "waiting");
  assert.equal(apply({ record: { state: "waiting", at: "2026-09-28T10:00:00Z" } }).since, "2026-09-28T10:00:00Z");
  assert.equal(apply({ record: { state: "done" } }).state, "done");
  // A saved card proves Payments is active, whatever was recorded.
  const seen = apply({ record: { state: "waiting" }, activeCards: 1 });
  assert.equal(seen.state, "done");
  assert.equal(seen.detected, true);
  // A refusal from Intuit outranks "I've applied".
  assert.equal(apply({ record: { state: "done" }, paymentsRefused: true }).state, "attention");
});

test("the payments permission is ticked off only when Intuit granted it", () => {
  assert.equal(outsideStepStatus("quickbooks_payments_reconnect", {}).state, "not_started");
  const granted = outsideStepStatus("quickbooks_payments_reconnect", { paymentsGranted: true });
  assert.equal(granted.state, "done");
  assert.equal(granted.detected, true);
});

test("Autopay guides both QuickBooks steps with the shared card", () => {
  const autopay = readFileSync("components/integrations/autopay-settings.tsx", "utf8");
  assert.match(autopay, /<OutsideStepCard[^>]*stepId="quickbooks_payments_apply"/);
  assert.match(autopay, /stepId="quickbooks_payments_reconnect"/);
  assert.doesNotMatch(autopay, /autopay-requirement/);
  // Three steps across, in order, not a list with a card nested in it.
  assert.match(autopay, /number=\{1\}[\s\S]*number=\{2\}/);
});
