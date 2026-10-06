import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TRIAL_NOTICE_DAYS,
  TRIAL_SERIES,
  TRIAL_SERIES_TYPES,
  TRUST_DIAL_APPROVALS,
  emailJobWasSent,
  summarizeTrialActivity,
  trialActivityIsEmpty,
  trialSeriesDue,
  trialSeriesJobId,
  trialStartedAt,
} from "../functions/src/saas/trial-series.ts";
import { trialNoticeDue } from "../functions/src/saas/billing-notices.ts";
import { billingHoldApplies } from "../functions/src/saas/billing-hold.ts";
import {
  TRIAL_EMAIL_TYPES,
  emailTemplateKeys,
  isPlatformEmailType,
  renderEmailTemplate,
  trialActivityLines,
} from "../functions/src/communications/email-templates.ts";
import { TRUST_DIAL_THRESHOLD } from "../features/messaging/trust-dial.ts";
import { settingsSectionHref } from "../features/settings/sections.ts";
import { TRIAL_NOTICE_DAYS as BANNER_TRIAL_NOTICE_DAYS } from "../features/subscriptions/billing-notice.ts";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.parse("2026-10-06T16:00:00.000Z");
const at = (days: number) => START + days * DAY;
const iso = (ms: number) => new Date(ms).toISOString();
const trial = (extra: Record<string, unknown> = {}) => ({
  status: "trialing",
  currentPeriodStart: iso(START),
  currentPeriodEnd: iso(at(14)),
  ...extra,
});

test("each day of a 14-day trial owes the latest step whose day has come, and nothing near the end", () => {
  const owed = Array.from({ length: 15 }, (_, day) => trialSeriesDue(trial(), at(day + 0.5))?.step ?? null);
  assert.deepEqual(owed, [
    "starts", "starts",
    "so_far", "so_far", "so_far", "so_far", "so_far",
    "without_asking", "without_asking", "without_asking",
    // Day 10 onward: inside "Your trial ends" (3 days) plus a clear day.
    null, null, null, null, null,
  ]);
  assert.equal(trialSeriesDue(trial(), at(14.5)), null, "trial over");
});

test("never collides with the trial-ending notice", () => {
  for (let hour = 0; hour < 15 * 24; hour += 1) {
    const now = START + hour * 60 * 60 * 1000;
    const record = trial();
    const series = trialSeriesDue(record, now);
    // The day before the trial-ending window, too.
    const endingSoon = trialNoticeDue(record, now) ?? trialNoticeDue(record, now + DAY);
    assert.ok(!(series && endingSoon), `both due at hour ${hour}`);
  }
  assert.equal(TRIAL_NOTICE_DAYS, BANNER_TRIAL_NOTICE_DAYS, "the in-app banner and the email agree");
});

test("only a trialing studio with full access: not comped, suspended, converted or ended", () => {
  const now = at(3);
  assert.equal(trialSeriesDue(trial({ comped: true }), now), null);
  assert.equal(trialSeriesDue(trial({ suspendedAt: iso(at(1)) }), now), null);
  assert.equal(trialSeriesDue(trial({ status: "active" }), now), null);
  assert.equal(trialSeriesDue(trial({ status: "past_due", pastDueSince: iso(at(2)) }), now), null);
  assert.equal(trialSeriesDue(trial({ status: "cancelled", cancelledAt: iso(at(2)) }), now), null);
  assert.equal(trialSeriesDue(trial({ status: "incomplete" }), now), null);
  assert.equal(trialSeriesDue(null, now), null);
  assert.equal(trialSeriesDue(trial(), now)?.type, "trial_cue_so_far");
});

test("the trial start is Stripe's period start, or fourteen days before the end", () => {
  assert.equal(trialStartedAt(trial(), iso(at(14))), iso(START));
  assert.equal(trialStartedAt(trial({ currentPeriodStart: null }), iso(at(14))), iso(START));
  // Extended in the Console: the series keeps its own clock, it doesn't restart.
  const extended = trial({ trialEndAt: iso(at(30)) });
  assert.equal(trialSeriesDue(extended, at(8))?.step, "without_asking");
  assert.equal(trialSeriesDue(extended, at(8))?.day, 8);
});

test("one job per studio per step, under a fixed id", () => {
  assert.equal(trialSeriesJobId("tenant_1", "so_far"), "trial_series_tenant_1_so_far");
  assert.deepEqual([...TRIAL_SERIES_TYPES], [...TRIAL_EMAIL_TYPES]);
  assert.deepEqual(TRIAL_SERIES.map((entry) => entry.fromDay), [0, 2, 7]);
});

test("the trust dial number is the product's own", () => {
  assert.equal(TRUST_DIAL_APPROVALS, TRUST_DIAL_THRESHOLD);
  assert.equal(settingsSectionHref("drafts"), "/studio/settings/automatic-drafts");
  assert.equal(settingsSectionHref("forwarding"), "/studio/settings/inquiry-capture");
});

const since = iso(START);
const later = iso(at(1));
const before = iso(at(-3));
const sent = (type: string, createdAt = later) => ({ type, status: "succeeded", result: { messageId: "m1" }, createdAt });

test("activity counts only what actually happened, since the trial started", () => {
  const activity = summarizeTrialActivity(
    {
      leads: [
        { createdAt: later },
        { createdAt: later },
        { createdAt: later, notInquiry: true },
        { createdAt: before },
      ],
      emailJobs: [
        sent("inquiry_acknowledgement"),
        sent("inquiry_acknowledgement"),
        sent("contract_reminder"),
        sent("proposal_sent"),
        sent("studio_new_inquiry"),
        sent("trial_cue_starts"),
        sent("inquiry_acknowledgement", before),
        { type: "inquiry_acknowledgement", status: "succeeded", result: { held: "reserved_test_address" }, createdAt: later },
        { type: "contract_reminder", status: "queued", createdAt: later },
      ],
      aiActions: [
        { status: "review_required", createdAt: later },
        { status: "executed", decision: { action: "approved" }, createdAt: later },
        { status: "approved", createdAt: later },
        { status: "rejected", createdAt: later },
        { status: "failed", createdAt: later },
        { status: "running", createdAt: later },
        { status: "review_required", createdAt: before },
      ],
    },
    since,
  );
  assert.deepEqual(activity, {
    inquiries: 2,
    acknowledged: 2,
    reminders: 1,
    emailsSent: 4,
    drafted: 4,
    approved: 2,
    waiting: 1,
  });
  assert.equal(trialActivityIsEmpty(activity), false);
  assert.equal(emailJobWasSent({ status: "succeeded", result: { held: "client_automations_paused" } }), false);
});

const brand = { studioName: "StudioCue", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: null };
const render = (key: string, values: Record<string, unknown>) =>
  renderEmailTemplate({ key, brand, recipientName: "Gabe Rivera", values: { studioName: "GR Productions", ...values } });

test("day 0: Cue starts today, with the three first steps and one button to setup", () => {
  const email = render("trial_cue_starts", { actionUrl: "https://studio-cue.com/studio/setup" });
  assert.equal(email.subject, "Cue starts today");
  assert.match(email.text, /Hi Gabe,/);
  assert.match(email.text, /on its own, at any hour/);
  assert.match(email.text, /Payments, signatures and anything Cue wrote in its own words always wait/);
  assert.match(email.text, /inbox forwarding or your inquiry link/);
  assert.match(email.text, /Connect QuickBooks/);
  assert.match(email.text, /jobs you've already booked/);
  assert.match(email.html, /studio-cue\.com\/studio\/setup/);
  assert.match(email.html, /<li/, "the three steps are a list");
  assert.match(email.text, /The StudioCue team/);
});

test("day 2: real numbers when there are some, and only the ones that aren't zero", () => {
  const email = render("trial_cue_so_far", {
    trialDays: 2,
    actionUrl: "https://studio-cue.com/studio",
    trialActivity: { inquiries: 3, acknowledged: 3, reminders: 0, emailsSent: 5, drafted: 2, approved: 1, waiting: 1 },
  });
  assert.equal(email.subject, "What Cue did so far");
  assert.match(email.text, /in your first 2 days/);
  assert.match(email.text, /3 inquiries came in/);
  assert.match(email.text, /3 inquiries acknowledged by Cue on its own/);
  assert.match(email.text, /5 emails sent for you/);
  assert.match(email.text, /2 drafts prepared for you, 1 approved/);
  assert.match(email.text, /One thing is waiting on you in Today/);
  assert.doesNotMatch(email.text, /reminder/i, "a zero is left out");
  assert.match(email.html, /studio-cue\.com\/studio"/);
  assert.deepEqual(trialActivityLines({ inquiries: 1, acknowledged: 0, reminders: 1, emailsSent: 1, drafted: 0, approved: 0, waiting: 0 }), [
    "- 1 inquiry came in",
    "- 1 reminder sent on schedule",
    "- 1 email sent for you in all, to clients, crew and venues",
  ]);
});

test("day 2: nothing happened, so the email says so and says how to give Cue work", () => {
  const empty = { inquiries: 0, acknowledged: 0, reminders: 0, emailsSent: 0, drafted: 0, approved: 0, waiting: 0 };
  assert.equal(trialActivityIsEmpty(empty), true);
  for (const trialActivity of [empty, undefined]) {
    const email = render("trial_cue_so_far", { trialDays: 3, trialActivity, actionUrl: "https://studio-cue.com/studio/settings/inquiry-capture" });
    assert.equal(email.subject, "Cue hasn't had anything to do yet");
    assert.match(email.text, /Nothing has reached Cue at GR Productions in your first 3 days/);
    assert.match(email.text, /Fill out your own inquiry form/);
    assert.doesNotMatch(email.text, /\b0 /, "no list of zeros");
    assert.match(email.html, /settings\/inquiry-capture/);
  }
});

test("day 7: the trust dial, what always waits, and the real settings page", () => {
  const email = render("trial_cue_without_asking", {
    trustApprovals: TRUST_DIAL_APPROVALS,
    actionUrl: "https://studio-cue.com/studio/settings/automatic-drafts",
  });
  assert.equal(email.subject, "What Cue can do without asking");
  assert.equal(email.preheader.includes("three times"), true);
  assert.match(email.text, /three times in a row without changing a word/);
  assert.match(email.text, /payments, anything that needs a signature, and any message Cue wrote in its own words/);
  assert.match(email.html, /studio-cue\.com\/studio\/settings\/automatic-drafts/);
});

test("trial mail is StudioCue's own, studio-facing, and never held", () => {
  for (const type of TRIAL_EMAIL_TYPES) {
    assert.ok((emailTemplateKeys as readonly string[]).includes(type), type);
    assert.equal(isPlatformEmailType(type), true, type);
    assert.equal(billingHoldApplies("emailJobs", type), false, type);
    for (const values of [{}, { trialActivity: { inquiries: 2 } }]) {
      const email = render(type, values);
      assert.doesNotMatch(`${email.subject} ${email.text}`, /wedding|couple|bride|groom/i, type);
      assert.doesNotMatch(email.text, /Conor/, "signed by the team, never a person");
    }
  }
});

test("the existing scheduler sends the series: no new function to deploy", () => {
  const source = readFileSync("functions/src/saas/billing-notices.ts", "utf8");
  const scheduler = source.slice(source.indexOf("export const billingNoticeScheduler"));
  assert.match(scheduler, /queueTrialSeries\(db, subscription, now\)/);
  assert.match(source, /if \(\(await db\.doc\(`emailJobs\/\$\{id\}`\)\.get\(\)\)\.exists\) return false;/);
  assert.doesNotMatch(readFileSync("functions/src/index.ts", "utf8"), /trial-series/);
});
