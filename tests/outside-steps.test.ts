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

test("Cue finds the step from the studio's own question, and only then", async () => {
  const { outsideStepForQuestion } = await import("../features/outside-steps/share");
  assert.equal(outsideStepForQuestion("How do I set up autopay?"), "quickbooks_payments_apply");
  assert.equal(outsideStepForQuestion("Can couples save a card on file?"), "quickbooks_payments_apply");
  assert.equal(outsideStepForQuestion("How do I reconnect QuickBooks for payments?"), "quickbooks_payments_reconnect");
  assert.equal(outsideStepForQuestion("How do I get inquiries from my website form into StudioCue?"), "inquiry_capture");
  assert.equal(outsideStepForQuestion("Set up inquiry capture"), "inquiry_capture");
  // Everyday questions about the work are not setup questions.
  for (const question of ["Reply to this inquiry", "What's due this week?", "Draft the final balance invoice", ""])
    assert.equal(outsideStepForQuestion(question), null, question);
});

test("the steps travel as plain text someone else can follow", async () => {
  const { outsideStepAsText, shareStepHref } = await import("../features/outside-steps/share");
  const text = outsideStepAsText("quickbooks_payments_apply", "GR Productions");
  assert.match(text, /^Apply for QuickBooks Payments — for GR Productions/);
  assert.match(text, /1\. Open Payments in QuickBooks/);
  assert.match(text, /Where: Settings → Account and settings → Payments/);
  assert.doesNotMatch(text, /\*\*/, "no markdown left in");
  const href = shareStepHref("quickbooks_payments_apply", "GR Productions");
  assert.match(href, /^mailto:\?subject=/);
  assert.match(decodeURIComponent(href), /Could you do this for GR Productions\?/);
  // A StudioCue page means nothing to a bookkeeper: only real web links go.
  const capture = outsideStepAsText("inquiry_capture", "GR Productions");
  assert.doesNotMatch(capture, /Link: \/studio/);
});

test("asking for help sends the step and where it stands, and nothing about clients", async () => {
  const { supportStepHref } = await import("../features/outside-steps/share");
  const href = supportStepHref(
    "quickbooks_payments_apply",
    outsideStepStatus("quickbooks_payments_apply", { record: { state: "waiting", at: "2026-09-22T12:00:00Z" } }),
    { studioName: "GR Productions", tenantId: "tenant_1", page: "/studio/integrations?tab=autopay" },
  );
  assert.match(href, /^mailto:support@studio-cue\.com\?subject=/);
  const body = decodeURIComponent(href);
  assert.match(body, /Step: Apply for QuickBooks Payments \(quickbooks_payments_apply\)/);
  assert.match(body, /Status: Applied — waiting on Intuit/);
  assert.match(body, /Studio: GR Productions \(tenant_1\)/);
});

test("the guide offers the hand-offs, and Cue shows the step under its answer", () => {
  const card = readFileSync("components/outside-steps/outside-step-card.tsx", "utf8");
  assert.match(card, /Send these steps to…/);
  assert.match(card, /Stuck\? Email us/);
  const cue = readFileSync("components/ai/copilot-workspace.tsx", "utf8");
  assert.match(cue, /<CueOutsideStep question=\{question\} \/>/);
});

test("Zoom meeting summaries: seen when the first summary arrives", async () => {
  const zoom = (signals: Parameters<typeof outsideStepStatus>[1]) =>
    outsideStepStatus("zoom_meeting_summaries", signals);
  assert.equal(zoom({}).state, "not_started");
  assert.equal(zoom({ record: { state: "waiting", at: "2026-09-28T10:00:00Z" } }).state, "waiting");
  const arrived = zoom({ record: { state: "waiting" }, zoomSummaries: true });
  assert.equal(arrived.state, "done");
  assert.equal(arrived.detected, true);
  const { outsideStepForQuestion } = await import("../features/outside-steps/share");
  assert.equal(outsideStepForQuestion("Why am I not getting Zoom summaries?"), "zoom_meeting_summaries");
  assert.equal(outsideStepForQuestion("How do I turn on meeting summaries?"), "zoom_meeting_summaries");
  assert.equal(outsideStepForQuestion("Book a Zoom call with Maya"), null);
  // The Zoom tile shows the step once Zoom is connected.
  const manager = readFileSync("components/integrations/integration-manager.tsx", "utf8");
  assert.match(manager, /stepId="zoom_meeting_summaries"/);
});
