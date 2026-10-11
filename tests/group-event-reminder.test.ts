import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  eventRemindersOn,
  groupReminderJobId,
  participantReminderDecision,
  participantReminderPlan,
  reminderDue,
} from "../functions/src/group-events/participant-reminders-core.ts";
import { eventSignupSettingsSchema, normaliseEventSignup } from "../features/group-events/signup.ts";
import { clientAutomationEmailTypes } from "../functions/src/imports/existing-booking.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import { CLIENT_EMAIL_TYPES, renderEmailTemplate } from "../functions/src/communications/email-templates.ts";
import { EDITABLE_EMAILS } from "../features/communications/email-catalog.ts";

/**
 * The day-before note to each parent or family at a group event
 * (functions/src/group-events/participant-reminders-core.ts).
 */

const read = (path: string) => readFileSync(path, "utf8");
const brand = { studioName: "GR Productions", productName: "StudioCue", accentColor: null, logoUrl: null, replyTo: null } as never;
const ZONE = "America/New_York";
const event = (extra: Record<string, unknown> = {}, signup: Record<string, unknown> = {}) => ({
  tenantId: "t",
  state: "BOOKED",
  eventDate: "2026-10-17",
  venueName: "Brookdale Park",
  city: "Montclair, NJ",
  groupEvent: {
    enabled: true,
    signup: {
      token: "tok_abcdefghijklmnop",
      options: [{ id: "a", name: "Mini", priceCents: 15000 }],
      methods: ["cash", "venmo", "quickbooks"],
      venmoHandle: "GR-Productions",
      open: true,
      ...signup,
    },
  },
  ...extra,
});
const family = (extra: Record<string, unknown> = {}) => ({
  tenantId: "t",
  status: "pay_on_day",
  email: "ana@example.com",
  parentName: "Ana Garcia",
  athleteName: "The Garcia family",
  packageName: "Mini",
  amountCents: 15000,
  chosenMethod: "cash",
  confirmationCode: "K7QX2M",
  slot: "09:20",
  ...extra,
});

// ── When ──

test("it's due from 9 AM the day before, in the event's own zone, and not after", () => {
  // 9 AM in New York on Oct 16 is 13:00 UTC.
  assert.equal(reminderDue(event(), new Date("2026-10-16T12:59:00Z"), ZONE), "not_yet");
  assert.equal(reminderDue(event(), new Date("2026-10-16T13:00:00Z"), ZONE), "due");
  assert.equal(reminderDue(event(), new Date("2026-10-17T03:30:00Z"), ZONE), "due", "11:30 PM on the 16th in New York is still the day before");
  assert.equal(reminderDue(event(), new Date("2026-10-17T13:00:00Z"), ZONE), "too_late");
  assert.equal(reminderDue(event(), new Date("2026-10-15T15:00:00Z"), ZONE), "not_yet");
  assert.equal(reminderDue(event({ eventDate: "" }), new Date(), ZONE), "no_date");
});

// ── Whether ──

test("only an event with a sign-up set up, reminders left on, and not put away or quieted", () => {
  assert.deepEqual(eventRemindersOn(event()), { on: true });
  assert.deepEqual(eventRemindersOn(event({ groupEvent: { enabled: false } })), { on: false, reason: "no_roster" });
  assert.deepEqual(eventRemindersOn(event({ groupEvent: { enabled: true } })), { on: false, reason: "no_signup" }, "a roster kept by hand isn't parent-facing");
  assert.deepEqual(eventRemindersOn(event({}, { reminders: false })), { on: false, reason: "turned_off" });
  assert.equal(eventRemindersOn(event({ archivedAt: "2026-10-10T00:00:00Z" })).on, false);
  assert.equal(eventRemindersOn(event({ state: "CANCELLED" })).on, false);
  assert.equal(eventRemindersOn(event({ clientAutomationsPausedAt: "2026-10-10T00:00:00Z" })).on, false);
  // On unless turned off — an event set up before the switch existed reminds too.
  assert.equal(normaliseEventSignup({ signup: {} }).reminders, true);
  assert.equal(eventSignupSettingsSchema.parse({ options: [{ id: "a", name: "M", priceCents: 1 }], methods: ["cash"], open: true }).reminders, true);
});

test("everyone with a place and an email, once each per event date", () => {
  const due = new Date("2026-10-16T14:00:00Z");
  const decide = (participant: Record<string, unknown>) =>
    participantReminderDecision({ project: event(), participantId: "p1", participant, now: due, zone: ZONE });
  assert.deepEqual(decide(family()), { send: true, id: groupReminderJobId("p1", "2026-10-17"), eventDate: "2026-10-17" });
  assert.deepEqual(decide(family({ status: "paid" })).send, true, "paid families hear too: see you tomorrow");
  assert.deepEqual(decide(family({ status: "cancelled" })), { send: false, reason: "cancelled" });
  assert.deepEqual(decide(family({ email: null })), { send: false, reason: "no_email" });
  assert.equal(groupReminderJobId("p1", "2026-10-17"), "group_reminder_p1_2026-10-17");
});

// ── As it sends ──

test("read again as it sends: the time they're booked for now, what they owe now, held if anything changed", () => {
  const job = { eventDate: "2026-10-17", timezone: ZONE };
  const now = new Date("2026-10-16T14:00:00Z");
  const plan = (participant: Record<string, unknown> | null, project: Record<string, unknown> | null = event(), at = now) =>
    participantReminderPlan({ job, project, participant, studioName: "GR Productions", now: at });
  const moved = plan(family({ slot: "10:40" }));
  assert.ok("values" in moved);
  assert.equal(moved.values.slotLabel, "10:40 AM", "a time the studio moved is said as it is now");
  assert.equal(moved.values.where, "Brookdale Park, Montclair, NJ");
  assert.equal(moved.values.amountText, "$150");
  assert.match(String(moved.values.howToPay), /cash at the event/);
  assert.deepEqual(plan(family({ status: "cancelled" })), { hold: "participant_cancelled" });
  assert.deepEqual(plan(family(), event({ eventDate: "2026-10-24" })), { hold: "event_date_moved" });
  assert.deepEqual(plan(family(), event({}, { reminders: false })), { hold: "turned_off" });
  assert.deepEqual(plan(family(), null), { hold: "job_missing" });
  assert.deepEqual(plan(family(), event(), new Date("2026-10-17T13:00:00Z")), { hold: "event_passed" }, "never 'tomorrow' on the day");
  const paid = plan(family({ status: "paid" }));
  assert.ok("values" in paid);
  assert.equal(paid.values.paid, true);
  assert.equal(paid.values.amountText, null);
  const venmo = plan(family({ chosenMethod: "venmo" }));
  assert.ok("values" in venmo);
  assert.match(String(venmo.values.payUrl), /^https:\/\/venmo\.com\/GR-Productions\?txn=pay&amount=150\.00/);
  const invoice = plan(family({ chosenMethod: "quickbooks", qbInvoice: { state: "open", hostedUrl: "https://connect.intuit.com/pay/x" } }));
  assert.ok("values" in invoice);
  assert.equal(invoice.values.payUrl, "https://connect.intuit.com/pay/x");
  const byHand = plan(family({ chosenMethod: null }));
  assert.ok("values" in byHand);
  assert.equal(byHand.values.howToPay, "GR Productions will take payment at the event.");
});

test("the sweep and the sender both use it, and it waits like any client automation", () => {
  assert.match(read("functions/src/communications/event-reminders.ts"), /await remindParticipants\(db, project, zone, now, tally\);/);
  const jobs = read("functions/src/operations/jobs.ts");
  assert.match(jobs, /type === "group_event_reminder" && document\.get\("participantId"\)[\s\S]*participantReminderPlanFor\(getFirestore\(\), document\)[\s\S]*if \("hold" in plan\) return \{ held: plan\.hold, type \};/);
  const queue = read("functions/src/group-events/participant-reminders.ts");
  assert.match(queue, /soleRecipient: true,\s*audience: "parent",/);
  assert.match(queue, /if \(reminderDue\(data, now, zone\) !== "due"\) return;/, "the roster is read only on its reminder day");
  assert.ok(clientAutomationEmailTypes.includes("group_event_reminder"), "a quieted job holds it");
  assert.equal(billingHoldApplies("emailJobs", "group_event_reminder"), true);
  assert.ok(CLIENT_EMAIL_TYPES.has("group_event_reminder"));
  assert.ok(EDITABLE_EMAILS.some((entry) => entry.key === "group_event_reminder"));
  assert.match(read("components/group-events/event-signup-panel.tsx"), /a reminder the day before\$\{slotsOn \? ", with their time" : ""\}/);
});

// ── What it says ──

test("a family's reminder leads with their time and where; a team day's with the day", () => {
  const session = renderEmailTemplate({
    key: "group_event_reminder",
    brand,
    recipientName: "Ana Garcia",
    projectName: "Fall Mini Sessions",
    values: {
      athleteName: "The Garcia family",
      slotLabel: "9:20 AM",
      where: "Brookdale Park, Montclair, NJ",
      confirmationCode: "K7QX2M",
      amountText: "$150",
      howToPay: "Pay GR Productions in cash at the event.",
      paid: false,
      eventKind: "portraits",
      actionUrl: "https://studio-cue.com/e/order/abc",
    },
  });
  assert.equal(session.subject, "Tomorrow at 9:20 AM: Fall Mini Sessions");
  assert.match(session.text, /Your session for The Garcia family is tomorrow at 9:20 AM at Brookdale Park, Montclair, NJ\. Please arrive a few minutes early\./);
  assert.match(session.text, /Show your confirmation number, K7QX2M, when you get there\./);
  assert.match(session.text, /Still to pay: \$150\. Pay GR Productions in cash at the event\./);
  assert.match(session.html, /href="https:\/\/studio-cue\.com\/e\/order\/abc"/);
  const team = renderEmailTemplate({
    key: "group_event_reminder",
    brand,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { athleteName: "Mia", where: "Parsippany, NJ", confirmationCode: "28L74P", paid: true, actionUrl: "https://studio-cue.com/e/order/def" },
  });
  assert.equal(team.subject, "Tomorrow: Spring Cheer Classic");
  assert.match(team.text, /GR Productions is at Spring Cheer Classic tomorrow at Parsippany, NJ, ready for Mia\./);
  assert.match(team.text, /You're all paid\. Thank you\./);
  const venmo = renderEmailTemplate({
    key: "group_event_reminder",
    brand,
    recipientName: "Dana Reyes",
    projectName: "Spring Cheer Classic",
    values: { amountText: "$45", paid: false, payUrl: "https://venmo.com/GR?txn=pay&amount=45.00", actionUrl: "https://studio-cue.com/e/order/def" },
  });
  assert.match(venmo.html, />Pay \$45</);
  assert.match(venmo.html, />See your order</);
  assert.doesNotMatch(session.text + team.text, /wedding|couple/i);
});
