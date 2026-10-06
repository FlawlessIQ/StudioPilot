import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PAYMENT_REMINDER,
  invoiceIsChaseable,
  nextPaymentReminder,
  paymentReminderActionId,
  paymentReminderDraft,
  paymentReminderLink,
  type PriorReminder,
} from "../functions/src/billing/payment-reminders.ts";
import { todayInbox, type TodayInput, type TodayJourneyPosition } from "@/features/today/inbox";

/**
 * Payment chasing (docs/positioning-office-manager-plan-2026-10-06.md, phase
 * 5): Cue drafts a reminder for a bill past due, the studio sends it from the
 * bill's overdue card on Today with one tap, and a bill paid in between is
 * never chased.
 */

const read = (path: string) => readFileSync(path, "utf8");
const TODAY = "2026-10-10";
const project = { tenantId: "t1", state: "PLANNING", name: "Hart Wedding" };
const overdue = { status: "sent", balanceCents: 455_000, dueDate: "2026-10-01", providerState: "completed" };

const sent = (sequence: number, decidedAt: string): PriorReminder => ({
  sequence,
  status: "executed",
  decision: "approved",
  decidedAt,
});

test("a bill a day past due, unpaid and sent, is chased", () => {
  assert.equal(invoiceIsChaseable(overdue, project, TODAY), true);
  assert.equal(invoiceIsChaseable({ ...overdue, dueDate: "2026-10-09" }, project, TODAY), true);
  // Due today is not late.
  assert.equal(invoiceIsChaseable({ ...overdue, dueDate: TODAY }, project, TODAY), false);
});

test("nothing is chased that isn't owed, isn't billed, or belongs to a job the studio stopped", () => {
  for (const status of ["paid", "voided", "superseded", "cancelled", "draft", "queued", "review_required", "failed"])
    assert.equal(invoiceIsChaseable({ ...overdue, status }, project, TODAY), false, status);
  assert.equal(invoiceIsChaseable({ ...overdue, balanceCents: 0 }, project, TODAY), false);
  assert.equal(invoiceIsChaseable({ ...overdue, dueDate: "" }, project, TODAY), false, "no due date");
  assert.equal(invoiceIsChaseable({ ...overdue, providerState: "pending" }, project, TODAY), false, "not raised yet");
  assert.equal(invoiceIsChaseable({ ...overdue, paymentFailedAt: "2026-10-02T00:00:00Z" }, project, TODAY), false, "declined card has its own card");
  assert.equal(invoiceIsChaseable(overdue, { ...project, archivedAt: "2026-10-05" }, TODAY), false, "put away");
  assert.equal(invoiceIsChaseable(overdue, { ...project, clientAutomationsPausedAt: "2026-09-01" }, TODAY), false, "quiet import");
  assert.equal(invoiceIsChaseable(overdue, { ...project, state: "CANCELLED" }, TODAY), false, "called off");
  assert.equal(invoiceIsChaseable(overdue, null, TODAY), false, "no job");
});

test("the cadence: first at once, the next a week after one was sent, three at most", () => {
  const next = (prior: PriorReminder[], today = TODAY) => nextPaymentReminder({ invoice: overdue, project, prior, today });
  assert.equal(next([]), 1);
  assert.equal(next([sent(1, "2026-10-05T10:00:00Z")]), null, "only five days since");
  assert.equal(next([sent(1, "2026-10-03T10:00:00Z")]), 2, "a week since");
  assert.equal(next([sent(1, "2026-09-20T10:00:00Z"), sent(2, "2026-10-03T10:00:00Z")]), 3);
  assert.equal(
    next([sent(1, "2026-09-01T10:00:00Z"), sent(2, "2026-09-08T10:00:00Z"), sent(3, "2026-09-15T10:00:00Z")]),
    null,
    `never more than ${PAYMENT_REMINDER.max}`,
  );
});

test("one waits at a time, and a declined reminder ends the chase", () => {
  const next = (prior: PriorReminder[]) => nextPaymentReminder({ invoice: overdue, project, prior, today: TODAY });
  assert.equal(next([{ sequence: 1, status: "review_required", decision: null, decidedAt: null }]), null);
  assert.equal(next([{ sequence: 1, status: "rejected", decision: "rejected", decidedAt: "2026-09-01T00:00:00Z" }]), null);
  assert.equal(next([{ sequence: 1, status: "dismissed", decision: "dismissed", decidedAt: "2026-09-01T00:00:00Z" }]), null);
  // An approval that failed to record a time doesn't start the clock.
  assert.equal(next([{ sequence: 1, status: "executed", decision: "approved", decidedAt: null }]), null);
});

test("draft ids are fixed per invoice and sequence, so a re-run never drafts twice", () => {
  assert.equal(paymentReminderActionId("inv_9", 2), "ai_payment_reminder_inv_9_2");
});

test("the reminder is the studio writing, with the amount and the date, and never names Cue", () => {
  const facts = {
    studioName: "GR Productions",
    clientFirstName: "Ella",
    projectName: "Hart Wedding",
    invoiceKind: "final",
    balanceCents: 455_000,
    dueDate: "2026-10-01",
    today: TODAY,
  };
  const drafts = [1, 2, 3].map((sequence) => paymentReminderDraft({ ...facts, sequence }));
  for (const draft of drafts) {
    assert.match(draft.body, /^Hi Ella,/);
    assert.match(draft.body, /\$4,550/);
    assert.match(draft.body, /October 1/);
    assert.match(draft.body, /— GR Productions$/);
    assert.doesNotMatch(`${draft.subject} ${draft.body}`, /\bCue\b/);
    assert.doesNotMatch(`${draft.subject} ${draft.body}`, /\b(colour|favour|organise|cheque)\b/i);
  }
  assert.match(drafts[0]!.subject, /^A reminder about your balance for Hart Wedding$/);
  assert.match(drafts[1]!.body, /9 days past its due date/);
  assert.match(drafts[2]!.body, /last email reminder/);
  assert.equal(drafts[0]!.title, "Remind Ella about the $4,550 balance");
  assert.match(paymentReminderDraft({ ...facts, sequence: 1, invoiceKind: "retainer" }).subject, /your retainer/);
  assert.match(paymentReminderDraft({ ...facts, sequence: 1, clientFirstName: null }).body, /^Hello,/);
  assert.match(paymentReminderDraft({ ...facts, sequence: 1, balanceCents: 12_345 }).body, /\$123\.45/);
});

test("the button goes to the provider's pay page, or else the client's payments page", () => {
  assert.equal(paymentReminderLink({ hostedUrl: "https://app.qbo.intuit.com/pay/abc" }, "p1", "https://studio-cue.com"), "https://app.qbo.intuit.com/pay/abc");
  assert.equal(paymentReminderLink({ hostedUrl: "javascript:alert(1)" }, "p1", "https://studio-cue.com/"), "https://studio-cue.com/client/payments?project=p1");
  assert.equal(paymentReminderLink({}, "p 1", "https://studio-cue.com"), "https://studio-cue.com/client/payments?project=p%201");
});

test("the daily invoice run drafts the reminders, and nothing makes them send on their own", () => {
  const scheduler = read("functions/src/operations/invoice-scheduler.ts");
  assert.match(scheduler, /await draftPaymentReminders\(db, overdue\.docs, owned, new Date\(\)\);/);
  const source = read("functions/src/billing/payment-reminders.ts");
  assert.match(source, /status: "review_required",/);
  assert.doesNotMatch(source, /emailJobs\//, "drafting never queues an email itself");
  assert.doesNotMatch(source, /lifecycleTrigger/, "not a lifecycle trigger, so the trust dial never offers auto-send");
});

test("a bill paid in between is caught at approval and again as the email goes", () => {
  const actions = read("functions/src/ai/actions.ts");
  // Read from the stored draft, never the browser's edit.
  assert.match(actions, /const paymentReminder = record\(record\(action\.get\("structuredOutput"\)\)\.paymentReminder\);/);
  assert.match(actions, /throw new Error\("PAYMENT_REMINDER_SETTLED"\)/);
  assert.match(read("functions/src/ai/approved-communication.ts"), /paymentReminderInvoiceId: input\.paymentReminderInvoiceId/);
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /if \(document\.get\("paymentReminderInvoiceId"\)\)/);
  assert.match(jobs, /return \{ held: "invoice_settled", type \};/);
  assert.match(read("lib/ai/friendly-error.ts"), /PAYMENT_REMINDER_SETTLED:/);
});

// ── Today ──────────────────────────────────────────────────────────────

const NOW = "2026-10-10T12:00:00.000Z";
const journey: TodayJourneyPosition = {
  projectId: "project-1",
  projectName: "Hart Wedding",
  eventDate: "2026-11-14",
  state: "PLANNING",
  stepTitle: "Planning",
  stepDetail: "Forms out",
  owner: "client",
  actionLabel: "Open",
  actionHref: "/studio/projects/project-1",
  updatedAt: "2026-10-01T09:00:00.000Z",
};
const invoice = { id: "inv-1", projectId: "project-1", balanceCents: 455_000, dueDate: "2026-10-01", status: "overdue", provider: "quickbooks" };
const draft = (overrides: Record<string, unknown> = {}) => ({
  id: "ai_payment_reminder_inv-1_1",
  projectId: "project-1",
  status: "review_required",
  capability: "delivery_message_draft",
  title: "Remind Ella about the $4,550 balance",
  structuredOutput: {
    subject: "A reminder about your balance for Hart Wedding",
    body: "Hi Ella,\n\nA quick reminder…",
    recipientEmail: "ella@example.com",
    paymentReminder: { invoiceId: "inv-1", sequence: 1 },
  },
  createdAt: "2026-10-02T06:00:00.000Z",
  updatedAt: "2026-10-02T06:00:00.000Z",
  ...overrides,
});
const base: TodayInput = { now: NOW, journeys: [journey], invoiceReferences: [invoice] };

test("Today: the drafted reminder is sent from the bill's own overdue card, not a second card", () => {
  const inbox = todayInbox({ ...base, aiActions: [draft()] });
  const card = inbox.act.find((item) => item.id === "invoice-inv-1");
  assert.equal(card?.title, "$4,550 overdue");
  assert.equal(card?.action.kind, "approve");
  if (card?.action.kind === "approve") {
    assert.equal(card.action.label, "Send reminder");
    assert.equal(card.action.actionId, "ai_payment_reminder_inv-1_1");
    assert.equal(card.action.preview?.subject, "A reminder about your balance for Hart Wedding");
  }
  assert.ok(card?.facts.includes("Cue drafted a reminder"), card?.facts.join());
  assert.equal(inbox.approve.filter((item) => item.id === "ai-ai_payment_reminder_inv-1_1").length, 0, "no second card");
});

test("Today: once sent, the card says when; with nothing drafted it points at the provider", () => {
  const sentOnce = todayInbox({
    ...base,
    aiActions: [draft({ status: "executed", decision: { action: "approved", decidedAt: "2026-10-03T15:00:00.000Z" } })],
  });
  const card = sentOnce.act.find((item) => item.id === "invoice-inv-1");
  assert.equal(card?.action.kind, "link");
  assert.ok(card?.facts.includes("reminded Oct 3, 2026"), card?.facts.join());

  const none = todayInbox(base).act.find((item) => item.id === "invoice-inv-1");
  assert.ok(none?.facts.includes("resend it from QuickBooks"), none?.facts.join());
});

test("Today: a reminder for a bill that's been paid is not offered anywhere", () => {
  const inbox = todayInbox({ ...base, invoiceReferences: [{ ...invoice, status: "paid", balanceCents: 0 }], aiActions: [draft()] });
  assert.equal(inbox.act.find((item) => item.id === "invoice-inv-1"), undefined);
  assert.equal(
    [...inbox.act, ...inbox.approve].some((item) => item.action.kind === "approve" && item.action.actionId === "ai_payment_reminder_inv-1_1"),
    false,
  );
});
