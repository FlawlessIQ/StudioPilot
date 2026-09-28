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

test("inquiry capture: done when an inquiry or the test arrives, waiting once set up", () => {
  const capture = (signals: Parameters<typeof outsideStepStatus>[1]) =>
    outsideStepStatus("inquiry_capture", signals);
  assert.equal(capture({}).state, "not_started");
  assert.equal(capture({ record: { state: "waiting", at: "2026-09-20T10:00:00Z" } }).state, "waiting");
  const arrived = capture({ record: { state: "waiting" }, captured: true });
  assert.equal(arrived.state, "done");
  assert.equal(arrived.detected, true);
});

test("Today asks only about a started wait that has run long, or a reported problem", async () => {
  const { outsideStepReminder } = await import("../features/outside-steps/registry");
  const now = new Date("2026-09-28T12:00:00Z");
  const waiting = (since: string) =>
    outsideStepStatus("quickbooks_payments_apply", { record: { state: "waiting", at: since } });
  // Two days in: Intuit usually takes 2–3 business days, so nothing yet.
  assert.equal(outsideStepReminder("quickbooks_payments_apply", waiting("2026-09-26T12:00:00Z"), now), null);
  const late = outsideStepReminder("quickbooks_payments_apply", waiting("2026-09-22T12:00:00Z"), now);
  assert.ok(late);
  assert.equal(late.title, "Heard back from Intuit?");
  assert.match(late.detail, /6 days ago/);
  assert.equal(late.href, "/studio/integrations?tab=autopay");
  assert.equal(late.urgent, false);
  // Never started: never nagged.
  assert.equal(
    outsideStepReminder("quickbooks_payments_apply", outsideStepStatus("quickbooks_payments_apply", {}), now),
    null,
  );
  // Intuit refused a card: raised straight away.
  const refused = outsideStepReminder(
    "quickbooks_payments_apply",
    outsideStepStatus("quickbooks_payments_apply", { paymentsRefused: true }),
    now,
  );
  assert.equal(refused?.urgent, true);
});

test("a reminder becomes a Today card that links to the step", async () => {
  const { todayInbox } = await import("../features/today/inbox");
  const inbox = todayInbox({
    now: "2026-09-28T12:00:00Z",
    outsideStepReminders: [
      {
        stepId: "inquiry_capture",
        title: "No inquiry has come through yet",
        detail: "You set up inquiry capture 4 days ago and nothing has arrived.",
        href: "/studio/settings/inquiry-capture",
        where: "your website form or inbox",
        urgent: false,
        since: "2026-09-24T12:00:00Z",
      },
    ],
  });
  const card = inbox.act.find((item) => item.id === "outside-inquiry_capture");
  assert.ok(card, "the reminder is on Today");
  assert.deepEqual(card.action, {
    kind: "link",
    label: "Update the step",
    href: "/studio/settings/inquiry-capture",
  });
  assert.equal(card.evidence, "Outside StudioCue · in your website form or inbox");
});

test("finishing a capture route's guide records the step as started", () => {
  const capture = readFileSync("components/intake/lead-capture-setup.tsx", "utf8");
  assert.match(capture, /setOutsideStep\("inquiry_capture", "waiting"/);
  assert.match(capture, /onDone=\{finishRoute\}/);
});
