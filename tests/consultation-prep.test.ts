import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  answerLines,
  consultationPrepDue,
  consultationPrepMessage,
  consultationPrepSetting,
  consultationPrepStale,
  howWeMeet,
  spokenCallTime,
  talkAboutFrom,
} from "../functions/src/booking/consultation-prep.ts";
import { SEND_ON_APPROVAL_CAPABILITIES as FUNCTIONS_SENDS } from "../functions/src/ai/approved-communication.ts";
import { SEND_ON_APPROVAL_CAPABILITIES as APP_SENDS } from "@/features/ai/approval-consequence";
import { defaultLifecycleMessagingSettings, lifecycleMessagingSettingsSchema, lifecycleTriggers } from "@/features/messaging/schema";
import { dueLifecycleMessages } from "@/features/messaging/lifecycle";
import { trustDialOffers } from "@/features/messaging/trust-dial";

/**
 * "Ahead of our call": the couple's answers and the call's details the day
 * before their consultation, with the AI's "things to talk about" only when a
 * person approves it. Nothing reached couples between booking and the call.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("due the day before the call, at once when booked later, never once it has started", () => {
  const startsAt = "2026-10-08T19:00:00.000Z";
  const at = (iso: string) => new Date(iso);
  assert.equal(consultationPrepDue({ startsAt, offsetDays: -1, now: at("2026-10-07T18:00:00Z") }), false, "25 hours out");
  assert.equal(consultationPrepDue({ startsAt, offsetDays: -1, now: at("2026-10-07T19:30:00Z") }), true, "under a day");
  assert.equal(consultationPrepDue({ startsAt, offsetDays: -2, now: at("2026-10-06T20:00:00Z") }), true);
  assert.equal(consultationPrepDue({ startsAt, offsetDays: 0, now: at("2026-10-08T15:00:00Z") }), false, "the morning of: three hours before");
  assert.equal(consultationPrepDue({ startsAt, offsetDays: 0, now: at("2026-10-08T16:30:00Z") }), true);
  assert.equal(consultationPrepDue({ startsAt, offsetDays: -1, now: at("2026-10-08T19:00:00Z") }), false, "the call has started");
  assert.equal(consultationPrepDue({ startsAt: "soon", offsetDays: -1, now: at("2026-10-08T19:00:00Z") }), false);
});

test("the studio's setting: on by default, the day before, waiting for review", () => {
  assert.deepEqual(consultationPrepSetting(undefined), { enabled: true, offsetDays: -1, autoSend: false });
  assert.deepEqual(consultationPrepSetting({ consultation_prep: { enabled: false, offsetDays: -2, autoSend: true } }), { enabled: false, offsetDays: -2, autoSend: true });
  assert.equal(consultationPrepSetting({ consultation_prep: { offsetDays: -30 } }).offsetDays, -1, "a week at most");
});

test("the call, in the couple's words", () => {
  assert.equal(spokenCallTime("2026-10-08T19:00:00.000Z", "America/New_York"), "Thursday, October 8 at 3:00 PM (EDT)");
  assert.equal(howWeMeet({ mode: "zoom", joinUrl: "https://zoom.us/j/1" }), "On Zoom: https://zoom.us/j/1");
  assert.match(howWeMeet({ mode: "zoom" }), /we'll send you the link/);
  assert.equal(howWeMeet({ mode: "phone", location: "555 0100" }), "We'll call you on 555 0100.");
  assert.equal(howWeMeet({ mode: "in_person", location: "12 Mill Rd" }), "In person, at 12 Mill Rd.");
});

test("their answers read back plainly; nothing they didn't answer or can't read", () => {
  const sections = [
    {
      id: "day",
      title: "Your day",
      fields: [
        { id: "intro", label: "A few questions", type: "information", required: false, locked: false, options: [], conditionalOn: null },
        { id: "date", label: "Wedding date", type: "date", required: true, locked: false, options: [], conditionalOn: null },
        { id: "time", label: "Ceremony start time?", type: "time", required: false, locked: false, options: [], conditionalOn: null },
        { id: "colours", label: "Colours", type: "multi_select", required: false, locked: false, options: [], conditionalOn: null },
        { id: "venue", label: "Venue:", type: "text", required: false, locked: false, options: [], conditionalOn: null },
        { id: "terms", label: "I agree", type: "acknowledgement", required: false, locked: false, options: [], conditionalOn: null },
        { id: "blank", label: "Planner", type: "text", required: false, locked: false, options: [], conditionalOn: null },
      ],
    },
  ];
  assert.deepEqual(
    answerLines(sections, { date: "2027-06-12", time: "16:30", colours: ["Sage", "Gold"], venue: "The Barn", terms: true, blank: "" }),
    ["• Wedding date: June 12, 2027", "• Ceremony start time: 4:30 PM", "• Colours: Sage, Gold", "• Venue: The Barn"],
  );
});

test("the AI's lines only with a person reading; the automatic note is the facts alone", () => {
  const facts = { studioName: "GR Productions", callTime: "Thursday, October 8 at 3:00 PM (EDT)", meeting: "On Zoom: https://zoom.us/j/1", answers: ["• Venue: The Barn"], inquiryUrl: "https://studio-cue.com/i/abc" };
  const full = consultationPrepMessage({ ...facts, talkAbout: ["Who's helping gather family for photos?"] });
  const alone = consultationPrepMessage({ ...facts, talkAbout: [] });
  assert.equal(full.subject, "Ahead of our call — Thursday, October 8");
  assert.match(full.body, /A few things we'd like to talk about:\n• Who's helping gather family/);
  assert.doesNotMatch(alone.body, /talk about/);
  assert.match(alone.body, /Here's what you've told us about your day so far:\n• Venue: The Barn/);
  assert.match(alone.body, /https:\/\/studio-cue\.com\/i\/abc/);
  assert.match(alone.body, /See you then,\nGR Productions$/);
  // From the analysis: its questions for the couple, never its notes to the studio.
  assert.deepEqual(
    talkAboutFrom({
      suggestedQuestions: ["Who's your planner?", "Who's your planner?", "ok", "Any family to keep apart?", "First look or not?", "Rain plan?", "Shot list?"],
      planningRisks: ["Tight light window"],
    }),
    ["Who's your planner?", "Any family to keep apart?", "First look or not?", "Rain plan?"],
  );
});

test("approving a note for a call that moved or passed is refused", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  assert.equal(consultationPrepStale({ status: "scheduled", startsAt: "2026-10-08T19:00:00Z" }, now), null);
  assert.equal(consultationPrepStale({ status: "rescheduled", startsAt: "2026-10-08T19:00:00Z" }, now), "CONSULTATION_PREP_STALE");
  assert.equal(consultationPrepStale({ status: "scheduled", startsAt: "2026-10-08T10:00:00Z" }, now), "CONSULTATION_PREP_STALE");
  assert.equal(consultationPrepStale(null, now), "CONSULTATION_PREP_STALE");
  assert.match(read("functions/src/ai/actions.ts"), /capability === "consultation_prep_draft"[\s\S]{0,400}consultationPrepStale\(/);
  for (const list of [FUNCTIONS_SENDS, APP_SENDS]) assert.ok((list as readonly string[]).includes("consultation_prep_draft"));
});

test("a studio's settings saved before this existed still parse — and the wedding-date engine never schedules it", () => {
  const before = {
    schedule_confirmation: { enabled: false, offsetDays: -21, autoSend: true },
    final_invoice_notice: { enabled: true, offsetDays: -30, autoSend: false },
    day_before_checklist: { enabled: true, offsetDays: -1, autoSend: false },
  };
  const parsed = lifecycleMessagingSettingsSchema.parse(before);
  assert.equal(parsed.schedule_confirmation.offsetDays, -21, "their own choices survive");
  assert.deepEqual(parsed.consultation_prep, { enabled: true, offsetDays: -1, autoSend: false });
  assert.ok(!(lifecycleTriggers as readonly string[]).includes("consultation_prep"));
  const due = dueLifecycleMessages({
    project: { id: "p", tenantId: "t", state: "BOOKED", eventDate: "2026-10-09" },
    settings: parsed,
    today: "2026-10-08",
  });
  assert.ok(due.every((item) => item.trigger !== ("consultation_prep" as string)));
});

test("three unedited approvals earn the offer to send it on its own", () => {
  const settings = defaultLifecycleMessagingSettings;
  const decisions = ["2026-10-01", "2026-10-02", "2026-10-03"].map((day) => ({
    trigger: "consultation_prep" as const,
    decidedAt: `${day}T10:00:00Z`,
    approved: true,
    edited: false,
  }));
  assert.ok(trustDialOffers(decisions, settings).includes("consultation_prep"));
});

test("wired: the scheduler is exported, can be invoked, and stays away from quiet bookings", () => {
  assert.match(read("functions/src/index.ts"), /consultationPrepScheduler/);
  assert.match(read("scripts/configure-production-function-invokers.sh"), /consultationprepscheduler/);
  assert.match(read("functions/src/booking/consultation-prep.ts"), /if \(clientOutreachStop\(job\)\) return "quiet";/);
});
