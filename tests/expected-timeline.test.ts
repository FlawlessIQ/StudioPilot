import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DEFAULTS,
  EXPECTED_TIMELINE,
  JOURNEY_CHAPTER_IDS,
  JOURNEY_STOPS,
  JOURNEY_VIDEO_IDS,
  SCHEDULE,
  journeyText,
  studioHasBookedAJob,
  whenLabel,
} from "@/features/journey/expected-timeline";
import { boldLabels } from "@/features/help/rich-text";
import { helpVideo, helpVideoIds } from "@/features/help/videos";
import { FIRST_NUDGE_DAYS, SECOND_NUDGE_DAYS, CLOSE_OFFER_DAYS } from "../functions/src/intake/follow-ups.ts";
import { DEFAULT_CONSULTATION_PREP } from "../functions/src/booking/consultation-prep.ts";
import { CONTRACT_REMINDER_DAYS } from "../functions/src/contracts/reminders.ts";
import { COI_DEFAULTS } from "../functions/src/coi/automation.ts";
import { BILLING_ADDRESS_REQUEST_WINDOW_DAYS } from "../functions/src/billing/billing-address-request.ts";
import { AUTOPAY_RETRY_AFTER_DAYS } from "../functions/src/billing/autopay-core.ts";
import {
  CREW_REMINDER_DAYS_BEFORE,
  EVENT_REMINDER_DAYS_BEFORE,
} from "../functions/src/communications/event-reminders-core.ts";
import { defaultLifecycleMessagingSettings as functionsLifecycle } from "../functions/src/communications/lifecycle-core.ts";
import { DEFAULT_PLANNING_TIMELINE as functionsPlanning } from "../functions/src/planning/planning-timeline.ts";

/**
 * "A wedding, start to finish" promises a studio and a prospect exact
 * timings: follow-ups on day 3 and 7, the final invoice 28 days out, crew
 * reminded 2 days before. Each one is a scheduler in functions/, which the
 * page can't import. This is the drift guard: change a scheduler and the page
 * that describes it goes red here, instead of quietly telling a studio
 * something the product no longer does (memory: copy-outlives-the-change).
 */

const source = (file: string) => readFileSync(path.join("functions", "src", file), "utf8");

/** The one number a regex captures, or a failure naming what moved. */
function captured(file: string, pattern: RegExp): number[] {
  const match = source(file).match(pattern);
  assert.ok(match, `${file} no longer matches ${pattern} — read the scheduler and update the page and this test`);
  return match.slice(1).map(Number);
}

test("the page's schedule is the schedulers' schedule (exported constants)", () => {
  assert.deepEqual(SCHEDULE.inquiryFollowUpDays, [FIRST_NUDGE_DAYS, SECOND_NUDGE_DAYS], "intake/follow-ups.ts");
  assert.equal(SCHEDULE.inquiryCloseOfferDays, CLOSE_OFFER_DAYS, "intake/follow-ups.ts");
  assert.equal(SCHEDULE.consultationPrepDaysBefore, -DEFAULT_CONSULTATION_PREP.offsetDays, "booking/consultation-prep.ts");
  assert.deepEqual(SCHEDULE.contractReminderDays, [...CONTRACT_REMINDER_DAYS], "contracts/reminders.ts");
  assert.equal(SCHEDULE.coiAskDaysBefore, COI_DEFAULTS.leadDays, "coi/automation.ts");
  assert.equal(SCHEDULE.coiChaseEveryDays, COI_DEFAULTS.chaseEveryDays, "coi/automation.ts");
  assert.equal(SCHEDULE.billingAddressDaysBefore, BILLING_ADDRESS_REQUEST_WINDOW_DAYS, "billing/billing-address-request.ts");
  assert.equal(SCHEDULE.autopayRetryAfterDays, AUTOPAY_RETRY_AFTER_DAYS, "billing/autopay-core.ts");
  assert.equal(SCHEDULE.coupleWeekOfDaysBefore, EVENT_REMINDER_DAYS_BEFORE, "communications/event-reminders-core.ts");
  assert.equal(SCHEDULE.crewReminderDaysBefore, CREW_REMINDER_DAYS_BEFORE, "communications/event-reminders-core.ts");
});

test("the page's schedule is the schedulers' schedule (numbers inside the code)", () => {
  assert.deepEqual(
    captured("operations/invoice-scheduler.ts", /target\.setUTCDate\(target\.getUTCDate\(\) \+ (\d+)\)/),
    [SCHEDULE.finalInvoiceRaisedDaysBefore],
    "the final invoice window",
  );
  assert.deepEqual(
    captured("booking/final-invoice.ts", /due\.setUTCDate\(due\.getUTCDate\(\) - (\d+)\)/),
    [SCHEDULE.finalInvoiceDueDaysBefore],
    "the final invoice due date",
  );
  assert.deepEqual(
    captured("coi/automation.ts", /const due = Math\.max\(event - (\d+) \* DAY_MS/),
    [SCHEDULE.coiDueDaysBefore],
    "the certificate due date",
  );
  for (const file of ["crew/prepare-staffing.ts", "crew/offer.ts"])
    assert.deepEqual(
      captured(file, /responseWindowHours \?\? (\d+)\)/),
      [SCHEDULE.crewOfferWindowHours],
      `${file}: the crew offer window`,
    );
  assert.deepEqual(
    captured("post-event/release.ts", /\[\[(\d+), "portal"\], \[(\d+), "email"\]\]/),
    [...SCHEDULE.reviewAskDaysAfterDelivery],
    "the review asks",
  );
  assert.deepEqual(
    captured("post-event/release.ts", /resume\(reviewDocs, \[(\d+), (\d+)\]/),
    [...SCHEDULE.reviewAskDaysAfterDelivery],
    "resumed review asks",
  );
  assert.deepEqual(
    captured("post-event/release.ts", /for \(const \[sequence, days\] of \[\[1, (\d+)\], \[2, (\d+)\]\]/),
    [...SCHEDULE.albumReminderDaysAfterDelivery],
    "the album reminders",
  );
});

test("the defaults it imports from features/ are the ones the schedulers run", () => {
  // features/ is the page's source; functions/ keeps a copy each. Both copies
  // already have parity tests of their own — this pins the page to the copy
  // that actually sends.
  assert.equal(DEFAULTS.planningFormMonthsBefore, functionsPlanning.formMonthsBefore);
  assert.equal(DEFAULTS.planningFormSend, functionsPlanning.formSend);
  assert.equal(DEFAULTS.detailsLockDaysBefore, functionsPlanning.lockDaysBefore);
  assert.equal(DEFAULTS.scheduleConfirmationDaysBefore, -functionsLifecycle.schedule_confirmation.offsetDays);
  assert.equal(DEFAULTS.finalInvoiceNoticeDaysBefore, -functionsLifecycle.final_invoice_notice.offsetDays);
  assert.equal(DEFAULTS.dayBeforeChecklistDaysBefore, -functionsLifecycle.day_before_checklist.offsetDays);
  assert.equal(DEFAULTS.consultationPrepDaysBefore, SCHEDULE.consultationPrepDaysBefore);
  // Drafts, not sends: the page files these under "You approve".
  for (const setting of Object.values(functionsLifecycle)) assert.equal(setting.autoSend, false);
  assert.equal(DEFAULT_CONSULTATION_PREP.autoSend, false);
  assert.equal(functionsPlanning.formSend, "remind", "the planning form waits for the studio by default");
});

test("the timing labels are derived from the numbers", () => {
  assert.equal(whenLabel({ anchor: "quiet", days: [3, 7] }), "After 3 and 7 quiet days");
  assert.equal(whenLabel({ anchor: "wedding", days: [-28] }), "4 weeks before");
  assert.equal(whenLabel({ anchor: "wedding", days: [-56] }), "8 weeks before");
  assert.equal(whenLabel({ anchor: "wedding", days: [-60] }), "60 days before");
  assert.equal(whenLabel({ anchor: "wedding", days: [-7] }), "A week before");
  assert.equal(whenLabel({ anchor: "wedding", days: [-2] }), "2 days before");
  assert.equal(whenLabel({ anchor: "wedding", days: [-1] }), "The day before");
  assert.equal(whenLabel({ anchor: "wedding", days: [0] }), "On the day");
  assert.equal(whenLabel({ anchor: "wedding", days: [1] }), "The day after");
  assert.equal(whenLabel({ anchor: "wedding", months: -6 }), "6 months before");
  assert.equal(whenLabel({ anchor: "offer_sent", hours: 24 }), "24 hours to answer");
  assert.equal(whenLabel({ anchor: "delivery", days: [3, 10] }), "3 and 10 days after delivery");
  assert.equal(whenLabel({ anchor: "form_due", days: [-14, -3] }), "14 and 3 days before it's due");
  assert.equal(whenLabel({ anchor: "call", days: [-1] }), "The day before the call");
  // No string in the stages types a timing by hand: each is an `at` offset or
  // interpolated from SCHEDULE/DEFAULTS, so a number can only go stale here.
  const file = readFileSync(path.join("features", "journey", "expected-timeline.ts"), "utf8");
  const block = file.slice(file.indexOf("export const EXPECTED_TIMELINE"), file.indexOf("export function journeyText"));
  const typed = [...block.matchAll(/"([^"\n]*)"/g)]
    .map((match) => match[1]!)
    // How far ahead a couple inquires is their pace, not a schedule.
    .filter((text) => text !== "12–18 months before")
    .filter((text) => /\b\d+\s*(days?|weeks?|hours?|months?)\b|\bday \d+\b/i.test(text));
  assert.deepEqual(typed, [], "put the timing in `at`, or interpolate it from SCHEDULE or DEFAULTS");
});

/** Same corpus and normalising as tests/help-content.test.ts. */
function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}
const normalise = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;|&#39;|’/g, "'")
    .replace(/&ldquo;|&rdquo;|“|”/g, '"')
    .replace(/&mdash;/g, "—");
const SELF = path.join("features", "journey", "expected-timeline.ts");
const PRODUCT_SOURCE = normalise(
  [...walk("components", (file) => /\.tsx?$/.test(file)), ...walk("app", (file) => /\.tsx?$/.test(file)), ...walk("features", (file) => /\.tsx?$/.test(file) && file !== SELF && !file.startsWith(path.join("features", "help")))]
    // The page itself names every label, so it can't vouch for them.
    .filter((file) => !file.endsWith(path.join("components", "help", "wedding-journey.tsx")))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n"),
);

test("every UI label the page names in bold still exists in the product", () => {
  const missing: string[] = [];
  for (const stage of EXPECTED_TIMELINE)
    for (const text of journeyText(stage))
      for (const label of boldLabels(text))
        if (!PRODUCT_SOURCE.includes(normalise(label))) missing.push(`${stage.id}: **${label}**`);
  assert.deepEqual(missing, [], "rename the label on the page, or restore it on the screen");
});

test("the stages run in order, cover every stop and every chapter of the film", () => {
  const ids = EXPECTED_TIMELINE.map((stage) => stage.id);
  assert.equal(new Set(ids).size, ids.length);
  const stopOrder = JOURNEY_STOPS.map((stop) => stop.id);
  const stops = EXPECTED_TIMELINE.map((stage) => stopOrder.indexOf(stage.stop));
  assert.deepEqual([...stops].sort((a, b) => a - b), stops, "stages follow the bar's order");
  assert.deepEqual([...new Set(EXPECTED_TIMELINE.map((stage) => stage.stop))], stopOrder, "every stop has a stage");
  assert.deepEqual(
    EXPECTED_TIMELINE.map((stage) => stage.video).filter(Boolean),
    [...JOURNEY_CHAPTER_IDS],
    "each chapter once, in order",
  );
  for (const stage of EXPECTED_TIMELINE) {
    assert.ok(stage.byItself.length + stage.youApprove.length > 0, `${stage.id}: says what happens`);
    assert.ok(stage.couple.length > 0, `${stage.id}: says what the couple sees`);
  }
});

test("chapter videos show only once the pipeline has published them", () => {
  const published = new Set(helpVideoIds());
  for (const id of JOURNEY_VIDEO_IDS) {
    assert.match(id, /^journey(-[1-8])?$/);
    assert.equal(helpVideo(id, "https://media.test/") !== null, published.has(id), id);
    assert.equal(helpVideo(id, undefined), null, "no media base, no video");
  }
});

test("Today offers the page only until the studio has booked a job", () => {
  assert.equal(studioHasBookedAJob(null), false);
  assert.equal(studioHasBookedAJob([]), false);
  assert.equal(studioHasBookedAJob([{ state: "LEAD" }, { state: "PROPOSAL" }, { state: "LOST" }]), false);
  assert.equal(studioHasBookedAJob([{ state: "LEAD" }, { state: "BOOKED" }]), true);
  assert.equal(studioHasBookedAJob([{ state: "CLOSED" }]), true);
});
