import assert from "node:assert/strict";
import test from "node:test";
import { describeDiscount, previewDiscount } from "../features/console/discount-preview.ts";
import { explainJobError, providerFromCode, statusFromMessage } from "../features/console/job-errors.ts";
import { issueTypeForKind, triageOf } from "../features/console/inbox.ts";
import { buildTimeline } from "../features/console/timeline.ts";
import { daysUntil, humanize, initials, money, plural, relative, shortDate, shortId } from "../lib/console/format.ts";
import { billingMomentText, planLabel, subscriptionBadge, toCsv } from "../lib/console/studio-display.ts";
import { describeTerms } from "../functions/src/console/handlers/codes.ts";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const at = (offsetDays: number) => new Date(NOW + offsetDays * 86_400_000).toISOString();

test("money and counts", () => {
  assert.equal(money(25_000), "$250");
  assert.equal(money(39_900, { cents: true }), "$399.00");
  assert.equal(money(null), "—");
  assert.equal(plural(1, "studio"), "1 studio");
  assert.equal(plural(3, "studio"), "3 studios");
});

test("relative time reads both ways and falls back to a date past a month", () => {
  assert.equal(relative(at(0), NOW), "just now");
  assert.equal(relative(new Date(NOW - 12 * 60_000).toISOString(), NOW), "12m ago");
  assert.equal(relative(new Date(NOW - 3 * 3_600_000).toISOString(), NOW), "3h ago");
  assert.equal(relative(at(3), NOW), "in 3d");
  assert.equal(relative(at(-45), NOW), shortDate(at(-45), NOW));
  assert.equal(relative(null, NOW), "—");
  assert.equal(daysUntil(at(2.5), NOW), 3);
});

test("ids shorten without losing their prefix; names become two letters", () => {
  assert.equal(shortId("tenant_be3901ee-cfb8-49d5-bc77-2c5992358b42"), "tenant_be39…8b42");
  assert.equal(shortId("short_id"), "short_id");
  assert.equal(initials("Juniper & Oak Photo"), "JO");
  assert.equal(initials("Madonna"), "MA");
  assert.equal(initials(""), "?");
  assert.equal(humanize("create_consultation_resources"), "Create consultation resources");
  assert.equal(humanize("lastActiveAt"), "Last active at");
});

test("plans, statuses and billing moments read as a person would say them", () => {
  assert.equal(planLabel("multi_brand", "yearly"), "Multi-Brand · yr");
  assert.equal(planLabel(null), "—");
  assert.deepEqual(subscriptionBadge("past_due"), { label: "Past due", tone: "bad" });
  assert.deepEqual(subscriptionBadge("active", true), { label: "Comped", tone: "accent" });
  assert.deepEqual(subscriptionBadge("incomplete"), { label: "No card yet", tone: "warn" });
  assert.deepEqual(billingMomentText({ kind: "trial_ends", at: at(3) }, NOW), { text: "ends in 3d", urgent: true });
  assert.deepEqual(billingMomentText({ kind: "trial_ends", at: at(11) }, NOW), { text: "ends in 11d", urgent: false });
  assert.equal(billingMomentText({ kind: "renews", at: at(20) }, NOW).text.startsWith("renews"), true);
  assert.deepEqual(billingMomentText({ kind: "none", at: null }, NOW), { text: "—", urgent: false });
});

test("CSV quotes what needs quoting", () => {
  assert.equal(toCsv(["A", "B"], [["Juniper & Oak", 'He said "hi", twice'], [null, 3]]), 'A,B\nJuniper & Oak,"He said ""hi"", twice"\n,3');
});

test("a job error says whether a rerun can help", () => {
  const zoom = explainJobError("ZOOM_NOT_CONNECTED", "ZOOM_NOT_CONNECTED");
  assert.equal(zoom.rerunHelps, false);
  assert.equal(zoom.studioFixes, true);
  assert.match(zoom.cause, /Zoom/);
  const payment = explainJobError("DROPBOX_SIGN_CREATE_FAILED", "DROPBOX_SIGN_CREATE_FAILED:402:PROVIDER_ERROR");
  assert.equal(payment.rerunHelps, false);
  assert.match(payment.cause, /Dropbox Sign/);
  assert.match(payment.cause, /payment required/);
  assert.equal(explainJobError("SENDGRID_SEND_FAILED", "SENDGRID_SEND_FAILED:503:upstream").rerunHelps, true);
  assert.equal(explainJobError("GOOGLE_CALENDAR_NOT_CONNECTED", "").studioFixes, true);
  assert.equal(explainJobError("VERTEX_AI_NOT_CONFIGURED", "").oursToFix, true);
  assert.equal(explainJobError("UNSUPPORTED_PROVIDER_JOB", "").oursToFix, true);
  assert.equal(explainJobError("PROJECT_NOT_FOUND", "").rerunHelps, false);
  assert.equal(explainJobError("SOMETHING_NEW", "").rerunHelps, true);
  // Both seen dead-lettered on production; a rerun fails the same way.
  assert.equal(explainJobError("IMPORT_SOURCE_MISSING", "IMPORT_SOURCE_MISSING").rerunHelps, false);
  assert.equal(explainJobError("IMPORT_SOURCE_MISSING", "").studioFixes, true);
  assert.equal(explainJobError("DROPBOX_PROJECT_ROOT_MISSING", "").rerunHelps, false);
  assert.match(explainJobError("DROPBOX_PROJECT_ROOT_MISSING", "").cause, /Dropbox folder/);
  assert.equal(statusFromMessage("X:429:slow"), 429);
  assert.equal(statusFromMessage("NO_STATUS"), null);
  assert.equal(providerFromCode("CALENDAR_CREATE_FAILED"), "Google Calendar");
});

test("the timeline merges every source newest first, with plain labels", () => {
  const entries = buildTimeline({
    audit: [
      { id: "a1", action: "platform.extendTrial", timestamp: at(-1), actorEmail: "team@x.test", reason: "Asked for more time", after: {} },
      { id: "a2", action: "platform.addNote", timestamp: at(-1) },
      { id: "a3", action: "project.created", actorType: "user", timestamp: at(-2) },
      { id: "a4", action: "project.created", actorType: "system", timestamp: at(-2) },
      { id: "a5", action: "platform.emailStudio", timestamp: at(-0.5), after: { subject: "Checking in" } },
    ],
    invoices: [
      { id: "in1", lastEvent: "invoice.payment_failed", amountDueCents: 39_900, attemptCount: 2, updatedAt: at(-0.1), nextPaymentAttemptAt: at(3) },
      { id: "in0", lastEvent: "invoice.paid", amountPaidCents: 0, paidAt: at(-30) },
    ],
    notes: [{ id: "n1", body: "Offer annual", createdAt: at(-3), pinned: true }, { id: "n2", body: "gone", createdAt: at(-3), archivedAt: at(-2) }],
    feedback: [{ id: "f1", kind: "broken", message: "Deposit says $0", createdAt: at(-4), userName: "Morgan" }],
    tasks: [{ id: "t1", title: "Call Sam", createdAt: at(-5), status: "open", dueAt: at(1) }],
  });
  assert.deepEqual(
    entries.map((entry) => entry.title),
    ["Payment failed: $399.00", "Team emailed the owner: Checking in", "Trial extended", "Project created", "Offer annual", "Something's broken: “Deposit says $0”", "Task: Call Sam"],
  );
  assert.equal(entries[0]!.tone, "bad");
  assert.match(entries[2]!.detail ?? "", /“Asked for more time” · by team@x.test/);
  assert.equal(entries[5]!.href, "/platform-admin/inbox?id=f1");
});

test("discount preview arithmetic", () => {
  const twenty = { percentOff: 20, amountOffCents: null, duration: "repeating" as const, durationMonths: 3 };
  const monthly = previewDiscount(twenty, 25_000, "monthly");
  assert.equal(monthly.discountedCents, 20_000);
  assert.equal(monthly.savingCents, 15_000);
  assert.equal(monthly.summary, "$250.00 → $200.00 / mo for 3 months");
  const yearly = previewDiscount({ ...twenty, durationMonths: 14 }, 250_000, "yearly");
  assert.equal(yearly.periods, 2, "repeating months on a yearly plan count whole years");
  assert.equal(yearly.savingCents, 100_000);
  const flat = previewDiscount({ percentOff: null, amountOffCents: 30_000, duration: "once", durationMonths: null }, 25_000, "monthly");
  assert.equal(flat.discountedCents, 0, "never below zero");
  assert.equal(previewDiscount({ ...twenty, duration: "forever" }, 25_000, "monthly").periods, null);
});

test("the browser and the server describe a code the same way", () => {
  const cases = [
    { percentOff: 20, amountOffCents: null, duration: "repeating" as const, durationMonths: 3 },
    { percentOff: 100, amountOffCents: null, duration: "forever" as const, durationMonths: null },
    { percentOff: null, amountOffCents: 5_000, duration: "once" as const, durationMonths: null },
    { percentOff: null, amountOffCents: 2_550, duration: "repeating" as const, durationMonths: 1 },
  ];
  for (const terms of cases) assert.equal(describeDiscount(terms), describeTerms(terms), JSON.stringify(terms));
});

test("inbox triage, derived for feedback from before the Console", () => {
  assert.equal(triageOf({ status: "received" }), "new");
  assert.equal(triageOf({ status: "shipped" }), "closed");
  assert.equal(triageOf({ status: "received", issueId: "i1" }), "linked");
  assert.equal(triageOf({ status: "received", issueId: "i1", triage: "closed" }), "closed");
  assert.equal(triageOf({ status: "received", triage: "waiting" }), "waiting");
  assert.equal(issueTypeForKind("broken"), "bug");
  assert.equal(issueTypeForKind("confusing"), "ux");
  assert.equal(issueTypeForKind("idea"), "request");
});
