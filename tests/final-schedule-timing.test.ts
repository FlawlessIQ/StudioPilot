import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { planningReviewDue } from "../functions/src/planning/planning-form-scheduler";
import { renderEmailTemplate } from "../functions/src/communications/email-templates";

/**
 * GR (2026-10-05): the final schedule "should be sent after contract signed,
 * and then again 6 months out", and at 6 months couples "actively update and
 * change times" in the same form.
 */

const AUTO = resolvePlanningTimeline({ formMonthsBefore: 6, formSend: "auto", lockDaysBefore: 28, formAtBooking: true, reviewAtFormDate: true });
const WEDDING = "2027-08-17"; // the form date is 2027-02-17; the lock 2027-07-20.

test("both switches are off unless a studio turns them on", () => {
  const plain = resolvePlanningTimeline({ formMonthsBefore: 6, formSend: "auto" });
  assert.equal(plain.formAtBooking, false);
  assert.equal(plain.reviewAtFormDate, false);
  assert.equal(resolvePlanningTimeline({ formAtBooking: "yes" }).formAtBooking, false, "only a real true turns it on");
  assert.equal(AUTO.formAtBooking, true);
  assert.equal(AUTO.reviewAtFormDate, true);
});

test("a review is asked once, of a form they filled in after booking, between the form date and the lock", () => {
  const sentAtBooking = { status: "submitted", createdAt: "2026-10-05T16:40:00.000Z", reviewRequestedAt: null };
  const due = (response: Record<string, unknown>, today: string, timeline = AUTO) =>
    planningReviewDue({ response, timeline, eventDate: WEDDING, today });
  assert.equal(due(sentAtBooking, "2027-02-17"), true, "the form date");
  assert.equal(due({ ...sentAtBooking, reviewRequestedAt: "2027-02-17T15:00:00Z" }, "2027-03-01"), false, "already asked");
  assert.equal(due({ ...sentAtBooking, status: "not_started" }, "2027-02-17"), false, "still blank: reminders, not a review");
  assert.equal(due({ ...sentAtBooking, createdAt: "2027-02-17T15:00:00Z" }, "2027-02-17"), false, "sent on the form date itself: just sent");
  assert.equal(due(sentAtBooking, "2027-07-20"), false, "locked");
  assert.equal(due(sentAtBooking, "2027-02-17", { ...AUTO, reviewAtFormDate: false }), false, "switch off");
  assert.equal(due(sentAtBooking, "2027-02-17", { ...AUTO, formSend: "remind" }), false, "a remind studio sends nothing itself");
});

const BRAND = { studioName: "GR Productions", productName: "StudioCue", accentColor: "#35664a", logoUrl: null, contactEmail: "hello@example.com" };

test("the review email asks them to look it over, not to start again", () => {
  const review = renderEmailTemplate({
    key: "questionnaire_request",
    brand: BRAND,
    recipientName: "Dionne",
    projectName: "Dionne Rhodes Wedding",
    values: { variant: "review", formName: "Final schedule", actionUrl: "https://studio-cue.com/client/questionnaire" },
  });
  assert.match(review.subject, /Anything changed\? Your final schedule with GR Productions/);
  assert.match(review.text, /Has anything changed\?/);
  assert.match(review.text, /Your answers are saved/);
  assert.match(review.text, /Review my details/);
  const first = renderEmailTemplate({
    key: "questionnaire_request",
    brand: BRAND,
    recipientName: "Dionne",
    projectName: "Dionne Rhodes Wedding",
    values: { actionUrl: "https://studio-cue.com/client/questionnaire" },
  });
  assert.match(first.text, /Help us plan the details/, "the first send is unchanged");
});

test("wired: the booking sends it before the early return, with the form date's own key", () => {
  const runtime = readFileSync("functions/src/operations/provider-runtime.ts", "utf8");
  const atBooking = runtime.indexOf("planningForm = await sendPlanningFormAtBooking(");
  const earlyReturn = runtime.indexOf('if(project.get("bookingProviderState")==="completed")return');
  assert.ok(atBooking > 0 && atBooking < earlyReturn, "runs on every pass, before the early return");
  const scheduler = readFileSync("functions/src/planning/planning-form-scheduler.ts", "utf8");
  assert.equal(scheduler.match(/idempotencyKey: `planning_form_\$\{project\.id\}_\$\{template\.id\}`/g)?.length, 2, "one key for both sends");
  assert.match(scheduler, /if \(data\.importedAt \|\| clientOutreachStop\(data\) !== null\) return "quiet";/);
});
