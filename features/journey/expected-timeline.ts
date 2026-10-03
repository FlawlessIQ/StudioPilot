import { defaultLifecycleMessagingSettings } from "@/features/messaging/schema";
import { DEFAULT_PLANNING_TIMELINE } from "@/features/planning/planning-timeline";
import { recommendedQuestionnaires } from "@/features/questionnaires/recommended-templates";

/**
 * "A wedding, start to finish": what to expect over the 12–18 months of one
 * wedding — what StudioCue does by itself, what the studio approves, and what
 * the couple and the crew see at each stage.
 *
 * It is the script for /studio/help/journey and the public
 * /how-to/wedding-journey, and the outline of the film of one wedding (Ella &
 * Marcus Hart) whose chapters are the `journey-1` … `journey-8` videos.
 *
 * Every timing here is a schedule the product really runs. Where the number
 * lives in features/ it is imported; where it lives only in functions/ (which
 * app code can't import) it is kept in SCHEDULE below, and
 * tests/expected-timeline.test.ts reads the scheduler's own source and fails
 * if the two disagree. A page that promises "three days" while the scheduler
 * waits seven is worse than no page (memory: copy-outlives-the-change).
 *
 * Copy uses the help system's one piece of markup: a **UI label** in bold,
 * spelled as the screen spells it. The same test checks each still exists.
 *
 * Pure data, no I/O.
 */

// ── The numbers ──────────────────────────────────────────────────────────

/**
 * Schedules that live only in functions/. Each one is held to its source by
 * tests/expected-timeline.test.ts — change the scheduler, and that test says
 * this page now lies.
 */
export const SCHEDULE = {
  /** functions/src/intake/follow-ups.ts FIRST_NUDGE_DAYS, SECOND_NUDGE_DAYS */
  inquiryFollowUpDays: [3, 7],
  /** functions/src/intake/follow-ups.ts CLOSE_OFFER_DAYS */
  inquiryCloseOfferDays: 14,
  /** functions/src/booking/consultation-prep.ts DEFAULT_CONSULTATION_PREP.offsetDays */
  consultationPrepDaysBefore: 1,
  /** functions/src/contracts/reminders.ts CONTRACT_REMINDER_DAYS */
  contractReminderDays: [3, 7],
  /** functions/src/crew/prepare-staffing.ts and offer.ts: `responseWindowHours ?? 24` */
  crewOfferWindowHours: 24,
  /** functions/src/coi/automation.ts COI_DEFAULTS.leadDays */
  coiAskDaysBefore: 60,
  /** functions/src/coi/automation.ts coiDue: `event - 14 * DAY_MS` */
  coiDueDaysBefore: 14,
  /** functions/src/coi/automation.ts COI_DEFAULTS.chaseEveryDays */
  coiChaseEveryDays: 3,
  /** functions/src/billing/billing-address-request.ts BILLING_ADDRESS_REQUEST_WINDOW_DAYS */
  billingAddressDaysBefore: 56,
  /** functions/src/operations/invoice-scheduler.ts: the 28-day window */
  finalInvoiceRaisedDaysBefore: 28,
  /** functions/src/booking/final-invoice.ts: due `eventDate - 14` */
  finalInvoiceDueDaysBefore: 14,
  /** functions/src/billing/autopay-core.ts AUTOPAY_RETRY_AFTER_DAYS */
  autopayRetryAfterDays: 3,
  /** functions/src/communications/event-reminders-core.ts EVENT_REMINDER_DAYS_BEFORE */
  coupleWeekOfDaysBefore: 7,
  /** functions/src/communications/event-reminders-core.ts CREW_REMINDER_DAYS_BEFORE */
  crewReminderDaysBefore: 2,
  /** functions/src/post-event/release.ts: `[[3, "portal"], [10, "email"]]` */
  reviewAskDaysAfterDelivery: [3, 10],
  /** functions/src/post-event/release.ts: album reminders `[[1, 7], [2, 14]]` */
  albumReminderDaysAfterDelivery: [7, 14],
} as const;

/** From features/: the studio's defaults, which a studio can change. */
const lifecycle = defaultLifecycleMessagingSettings;
const planning = DEFAULT_PLANNING_TIMELINE;
/** The planning form StudioCue recommends — "Final schedule", sent six months out. */
const finalSchedule = recommendedQuestionnaires().find((form) => form.id === "wedding-final-schedule")!;

export const DEFAULTS = {
  planningFormMonthsBefore: planning.formMonthsBefore,
  planningFormSend: planning.formSend,
  detailsLockDaysBefore: planning.lockDaysBefore,
  planningFormDueDaysBefore: finalSchedule.dueDaysBeforeEvent,
  planningFormReminderDaysBeforeDue: finalSchedule.reminderDaysBeforeDue,
  scheduleConfirmationDaysBefore: -lifecycle.schedule_confirmation.offsetDays,
  finalInvoiceNoticeDaysBefore: -lifecycle.final_invoice_notice.offsetDays,
  dayBeforeChecklistDaysBefore: -lifecycle.day_before_checklist.offsetDays,
  consultationPrepDaysBefore: -lifecycle.consultation_prep.offsetDays,
} as const;

// ── When ─────────────────────────────────────────────────────────────────

/**
 * What a moment is timed from. `quiet` is the studio's last message before
 * the couple went quiet (follow-ups.ts counts a round from it); `form_due` is
 * the planning form's due date.
 */
export type JourneyAnchor =
  | "wedding"
  | "quiet"
  | "call"
  | "contract_sent"
  | "offer_sent"
  | "form_due"
  | "delivery";

/** One or more offsets from an anchor. Negative is before it. */
export type JourneyOffset =
  | { anchor: JourneyAnchor; days: readonly number[] }
  | { anchor: "wedding"; months: number }
  | { anchor: "offer_sent"; hours: number };

const andList = (values: readonly number[]) =>
  values.length <= 1
    ? String(values[0] ?? "")
    : `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** "4 weeks", "60 days", "a week": how far, for a single count of days. */
export function distance(days: number): string {
  const n = Math.abs(days);
  if (n === 7) return "a week";
  if (n >= 14 && n % 7 === 0 && n <= 56) return plural(n / 7, "week");
  return plural(n, "day");
}

/**
 * The human "when" for an offset — derived, never typed, so a number can only
 * change in one place.
 */
export function whenLabel(offset: JourneyOffset): string {
  if ("months" in offset) return `${plural(Math.abs(offset.months), "month")} before`;
  if ("hours" in offset) return `${plural(offset.hours, "hour")} to answer`;
  const days = offset.days;
  const all = (sign: 1 | -1) => days.every((day) => Math.sign(day) === sign);
  const single = days.length === 1 ? days[0]! : null;
  switch (offset.anchor) {
    case "wedding":
      if (single === 0) return "On the day";
      if (single === -1) return "The day before";
      if (single === 1) return "The day after";
      if (single !== null) return capitalise(`${distance(single)} ${single < 0 ? "before" : "after"}`);
      return `${andList(days.map(Math.abs))} days ${all(-1) ? "before" : "after"}`;
    case "quiet":
      return `After ${andList(days)} quiet days`;
    case "call":
      return single === -1 ? "The day before the call" : `${andList(days.map(Math.abs))} days before the call`;
    case "contract_sent":
      return `${andList(days)} days after it's sent`;
    case "offer_sent":
      return `${andList(days)} days after the offer`;
    case "form_due":
      return `${andList(days.map(Math.abs))} days before it's due`;
    case "delivery":
      return single !== null ? capitalise(`${distance(single)} after delivery`) : `${andList(days)} days after delivery`;
  }
}

// ── The stages ───────────────────────────────────────────────────────────

/** The six stops on the bar at the top of the page, matching the film. */
export const JOURNEY_STOPS = [
  { id: "inquiry", label: "Inquiry" },
  { id: "booked", label: "Booked" },
  { id: "planning", label: "Planning" },
  { id: "wedding", label: "Wedding" },
  { id: "gallery", label: "Gallery" },
  { id: "closed", label: "Closed" },
] as const;
export type JourneyStop = (typeof JOURNEY_STOPS)[number]["id"];

/**
 * The public page (app/how-to/wedding-journey), and its stages by anchor
 * (`#stage-<id>`, components/help/wedding-journey.tsx). One spelling for every
 * link the website makes to it; tests/marketing-claims.test.ts checks each
 * anchor names a real stage.
 */
export const JOURNEY_PAGE = "/how-to/wedding-journey";
export function journeyStageHref(stageId: string): string {
  return `${JOURNEY_PAGE}#stage-${stageId}`;
}

/** The whole film, then its eight chapters. Published to video-manifest.json by the video pipeline. */
export const JOURNEY_FILM_ID = "journey";
export const JOURNEY_CHAPTER_IDS = [
  "journey-1",
  "journey-2",
  "journey-3",
  "journey-4",
  "journey-5",
  "journey-6",
  "journey-7",
  "journey-8",
] as const;
export type JourneyChapterId = (typeof JOURNEY_CHAPTER_IDS)[number];
export const JOURNEY_VIDEO_IDS: readonly string[] = [JOURNEY_FILM_ID, ...JOURNEY_CHAPTER_IDS];

export type JourneyMoment = {
  /** The copy. **Bold** is a UI label, spelled as the screen spells it. */
  text: string;
  /** When it happens; the label is derived from this. */
  at?: JourneyOffset;
  /** The condition it depends on, said plainly: "Only if…", "Or…". */
  note?: string;
};

export type ExpectedStage = {
  id: string;
  stop: JourneyStop;
  title: string;
  /** Human, for the stage heading: "6 months before", "The week of". */
  when: string;
  /**
   * The span `when` describes. `typical` marks a span set by the couple's
   * pace rather than by a schedule — an inquiry 12–18 months out is usual,
   * not something StudioCue decides.
   */
  span: { from: JourneyOffset; to?: JourneyOffset; typical?: boolean };
  /** One or two sentences. */
  summary: string;
  /** What StudioCue does with nobody pressing anything. */
  byItself: JourneyMoment[];
  /** One-tap decisions, waiting on Today or the job. */
  youApprove: JourneyMoment[];
  /** What the couple sees and gets, including which email. */
  couple: JourneyMoment[];
  /** What the crew sees, or null when there is nothing for them yet. */
  crew: JourneyMoment[] | null;
  /** This stage's chapter of the film, or null when the previous chapter covers it. */
  video: JourneyChapterId | null;
};

const S = SCHEDULE;
const LAST_ALBUM_REMINDER = S.albumReminderDaysAfterDelivery[S.albumReminderDaysAfterDelivery.length - 1];
const D = DEFAULTS;
const wedding = (...days: number[]): JourneyOffset => ({ anchor: "wedding", days });

export const EXPECTED_TIMELINE: readonly ExpectedStage[] = [
  {
    id: "inquiry",
    stop: "inquiry",
    title: "A couple inquires",
    when: "12–18 months before",
    span: { from: { anchor: "wedding", months: -18 }, to: { anchor: "wedding", months: -12 }, typical: true },
    summary:
      "The couple fills in the inquiry form on your website, or you forward their email. It becomes a job the moment it arrives, so nothing slips.",
    byItself: [
      { text: "Adds the inquiry to **Inquiries** as a job, with their date, venue and message." },
      { text: "Drafts your first reply, with a link where the couple adds their details and picks a time to talk." },
      {
        text: "No answer? Drafts a friendly follow-up.",
        at: { anchor: "quiet", days: S.inquiryFollowUpDays },
      },
    ],
    youApprove: [
      { text: "Read the reply on **Today** and tap **Send reply** — or **Edit** it first." },
      { text: "Send each follow-up with **Send follow-up**, or leave it." },
      {
        text: "Still nothing? Today asks: **Close — went quiet** or **Keep it open**.",
        at: { anchor: "quiet", days: [S.inquiryCloseOfferDays] },
      },
    ],
    couple: [
      { text: "Your reply, by email, with a link to their own inquiry page." },
      {
        text: "On that page they tell you about the day and pick a time to talk.",
        note: "The booking link appears once your consultation hours are set.",
      },
    ],
    crew: null,
    video: "journey-1",
  },
  {
    id: "consultation",
    stop: "inquiry",
    title: "The consultation",
    when: "A week or two later",
    span: { from: { anchor: "wedding", months: -18 }, to: { anchor: "wedding", months: -12 }, typical: true },
    summary: "The couple books the call themselves. StudioCue confirms it and gets you both ready for it.",
    byItself: [
      { text: "Puts the call on your **Calendar** and on the job, and emails the couple a confirmation." },
      { text: "Reads their answers and notes a few things worth asking about — for you, not for them." },
    ],
    youApprove: [
      {
        text: "An “Ahead of our call” note for the couple: the call's time, their answers read back, and the questions worth talking through. Approve it on **Today**.",
        at: { anchor: "call", days: [-D.consultationPrepDaysBefore] },
        note: "Switch it to automatic and only the facts go — never the suggested questions.",
      },
    ],
    couple: [
      { text: "A confirmation email the moment they book, with the call's details." },
      {
        text: "A short note with when the call is and what they told you.",
        at: { anchor: "call", days: [-D.consultationPrepDaysBefore] },
      },
    ],
    crew: null,
    video: "journey-2",
  },
  {
    id: "booking",
    stop: "booked",
    title: "Getting booked",
    when: "Soon after the call",
    span: { from: { anchor: "wedding", months: -18 }, to: { anchor: "wedding", months: -12 }, typical: true },
    summary:
      "One proposal, one signature, one payment. The job books itself when the last one lands.",
    byItself: [
      {
        text: "When the couple accepts, prepares their agreement with their details and price — and sends it, signed for you.",
        note: "Sends only if you've turned on automatic sending. Otherwise it waits for you as a draft.",
      },
      {
        text: "Reminds the couple to sign.",
        at: { anchor: "contract_sent", days: S.contractReminderDays },
        note: "With StudioCue signing.",
      },
      {
        text: "Raises the retainer invoice as soon as they sign.",
        note: "Only with QuickBooks connected. Otherwise, record the payment yourself.",
      },
      {
        text: "Confirms the booking once the agreement is signed and the retainer has cleared. The job moves from Inquiries to **Jobs**.",
      },
    ],
    youApprove: [
      { text: "Build the proposal from your packages, **Approve this proposal** and **Send proposal**." },
      { text: "If the agreement waits as a draft: type your name and **Sign & send**." },
    ],
    couple: [
      { text: "The proposal by email. In their portal they **Accept proposal**, or ask for changes." },
      { text: "Their agreement, signed on their phone with their typed name (**Review & sign**). A signed copy is emailed to them." },
      { text: "The retainer invoice. Paying it reserves their date." },
    ],
    crew: null,
    video: "journey-3",
  },
  {
    id: "crew",
    stop: "booked",
    title: "Your crew",
    when: "Right after booking",
    span: { from: { anchor: "wedding", months: -18 }, to: { anchor: "wedding", months: -6 }, typical: true },
    summary: "Booking writes the staffing plan: each role the package needs, who to ask, in order.",
    byItself: [
      { text: "Prepares the plan the moment the job books: each role, a ranked shortlist, the times and the rate." },
      {
        text: "Offers the job to one person at a time. A no, or no answer in time, and it asks the next name.",
        at: { anchor: "offer_sent", hours: S.crewOfferWindowHours },
      },
    ],
    youApprove: [
      {
        text: "Check the plan and tap **Send these offers**.",
        note: "Or turn on automatic offers, and the first ones go out at booking.",
      },
      { text: "Nobody left on the list? **Offer to someone else** starts a new round." },
      { text: "Approve or waive each crew member's paperwork: the W-9 and any insurance." },
    ],
    couple: [{ text: "Nothing to do. Crew is arranged behind the scenes." }],
    crew: [
      { text: "An offer by email: the date, the times, the fee and **What you'd do**." },
      { text: "They **Accept** or decline from their phone, before the **Answer by** time." },
      { text: "An accepted job moves to their **Jobs**, with a checklist of anything you need from them." },
    ],
    video: "journey-4",
  },
  {
    id: "quiet",
    stop: "planning",
    title: "The quiet months",
    when: `Booking until ${plural(D.planningFormMonthsBefore, "month")} before`,
    span: { from: { anchor: "wedding", months: -12 }, to: { anchor: "wedding", months: -D.planningFormMonthsBefore } },
    summary: "Nothing needs you. This wedding stays off Today until there's something to do.",
    byItself: [
      { text: "Keeps the job in **Jobs** with nothing outstanding, and brings it back to **Today** by itself when it needs you." },
    ],
    youApprove: [],
    couple: [
      { text: "Their portal counts down to the day. **Your studio is on it** means there's nothing for them to do." },
      { text: "Want something extra? **Add to your booking** asks you, and the request shows on your Today." },
    ],
    crew: [{ text: "The date sits in their **Jobs**. **Add to my calendar** saves it." }],
    video: "journey-5",
  },
  {
    id: "planning",
    stop: "planning",
    title: "Planning",
    when: `${plural(D.planningFormMonthsBefore, "month")} to ${distance(S.finalInvoiceDueDaysBefore)} before`,
    span: { from: { anchor: "wedding", months: -D.planningFormMonthsBefore }, to: wedding(-S.finalInvoiceDueDaysBefore) },
    summary:
      "The planning form goes out, the run of show is built from the answers, and the money and paperwork line up.",
    byItself: [
      {
        text: "Reminds the couple to send their planning form back.",
        at: { anchor: "form_due", days: D.planningFormReminderDaysBeforeDue.map((day) => -day) },
        note: `StudioCue's recommended form is due ${distance(D.planningFormDueDaysBefore)} before the wedding.`,
      },
      {
        text: "Asks your insurance agent for the venue's certificate, and chases it until it arrives.",
        at: wedding(-S.coiAskDaysBefore),
        note: `Only when the venue needs one. Due ${distance(S.coiDueDaysBefore)} before; chased every ${plural(S.coiChaseEveryDays, "day")}.`,
      },
      {
        text: "Asks the couple for a billing address, if none is on file.",
        at: wedding(-S.billingAddressDaysBefore),
        note: "Only with QuickBooks itemised invoices and sales tax.",
      },
      {
        text: `Raises the final invoice through QuickBooks, due ${distance(S.finalInvoiceDueDaysBefore)} before the wedding.`,
        at: wedding(-S.finalInvoiceRaisedDaysBefore),
      },
      {
        text: "Locks the details: the couple confirms where and when, and any change after that is a request you agree to.",
        at: wedding(-D.detailsLockDaysBefore),
      },
      {
        text: `Charges the couple's saved card for the final balance, with one retry ${plural(S.autopayRetryAfterDays, "day")} later if it's declined.`,
        at: wedding(-S.finalInvoiceDueDaysBefore),
        note: "Only if you've turned on autopay and the couple saved a card.",
      },
    ],
    youApprove: [
      {
        text: "Tap **Send the form** when Today offers it.",
        at: { anchor: "wedding", months: -D.planningFormMonthsBefore },
        note: "Or let it send itself: **Planning timeline** in Settings.",
      },
      { text: "Draft the run of show from their answers with **Generate draft**, check it, then **Publish reviewed schedule**." },
      {
        text: "Approve the certificate request, then **Approve & send to venue** when it's back.",
        at: wedding(-S.coiAskDaysBefore),
      },
      {
        text: "Two drafts on Today: confirming the timeline with the couple, and a note about the final balance.",
        at: wedding(-D.scheduleConfirmationDaysBefore),
      },
      { text: "After the lock, a change request from the couple: accept or decline it on Today." },
    ],
    couple: [
      { text: "The planning form, with what they've already told you filled in." },
      {
        text: "Reminders before it's due.",
        at: { anchor: "form_due", days: D.planningFormReminderDaysBeforeDue.map((day) => -day) },
      },
      { text: "Their timeline to check: **Approve timeline** or **Ask for changes**." },
      {
        text: "**Confirm our final details**, by typing their name.",
        at: wedding(-D.detailsLockDaysBefore),
      },
      {
        text: "The final invoice by email — or, with a saved card, nothing to do.",
        at: wedding(-S.finalInvoiceRaisedDaysBefore),
      },
    ],
    crew: [
      { text: "The published run of show on their **Day sheet**. They tap **I've read version** to confirm it." },
      { text: "Any paperwork still owed, on their job's **Checklist**." },
    ],
    video: "journey-6",
  },
  {
    id: "wedding-week",
    stop: "wedding",
    title: "The wedding week",
    when: "The week of",
    span: { from: wedding(-S.coupleWeekOfDaysBefore), to: wedding(0) },
    summary: "Everyone gets what they need for the day, without you writing a single email.",
    byItself: [
      { text: "Emails the couple a week-of note with a link to their timeline.", at: wedding(-S.coupleWeekOfDaysBefore) },
      {
        text: "Emails each crew member their call time, where to be and a link to the day sheet.",
        at: wedding(-S.crewReminderDaysBefore),
      },
    ],
    youApprove: [
      { text: "The day-before checklist for the couple. Approve it on **Today**.", at: wedding(-D.dayBeforeChecklistDaysBefore) },
      {
        text: "On the day, **Event day** has the venue, the run of show and who's working. **Ask the event brief** anything.",
        at: wedding(0),
      },
    ],
    couple: [
      { text: "A week-of email with a link straight to their timeline.", at: wedding(-S.coupleWeekOfDaysBefore) },
      { text: "The day-before checklist, once you approve it.", at: wedding(-D.dayBeforeChecklistDaysBefore) },
    ],
    crew: [
      { text: "An email with their call time, where to be and the day sheet.", at: wedding(-S.crewReminderDaysBefore) },
      {
        text: "**Open the day sheet**: where, who to call, their role and the running order. It opens with no signal.",
        at: wedding(0),
      },
    ],
    video: "journey-7",
  },
  {
    id: "after",
    stop: "gallery",
    title: "After the wedding",
    when: "The day after, to a few weeks on",
    span: { from: wedding(1), to: { anchor: "delivery", days: [LAST_ALBUM_REMINDER] } },
    summary: "One question the day after, then the gallery goes out and the follow-ups run themselves.",
    byItself: [
      {
        text: "Asks the couple for a review: in their portal first, then by email. It stops once they've left one.",
        at: { anchor: "delivery", days: S.reviewAskDaysAfterDelivery },
        note: "Only once you've added your review link.",
      },
      {
        text: "Reminds the couple to choose their album photos.",
        at: { anchor: "delivery", days: S.albumReminderDaysAfterDelivery },
        note: "Only when the package has an album.",
      },
    ],
    youApprove: [
      { text: "**Did this go ahead?** Tap **Yes, we shot it**.", at: wedding(1) },
      { text: "Approve your crew's hours and expenses, and set when they're paid." },
      { text: "Record the gallery — link, access code, download date — and **Release to the couple**." },
    ],
    couple: [
      { text: "One email with their gallery link and access code. Everything lands in their portal." },
      { text: "With an album: they choose photos, then approve the design." },
      {
        text: "**Would you share a few words?** links to your review page.",
        at: { anchor: "delivery", days: S.reviewAskDaysAfterDelivery },
      },
    ],
    crew: [
      {
        text: "**Hours and expenses**: when they started and finished, any costs and links to their files. Then **Send to the studio**.",
        at: wedding(1),
      },
    ],
    video: "journey-8",
  },
  {
    id: "closed",
    stop: "closed",
    title: "Wrap up",
    when: "Once everything's in",
    span: { from: { anchor: "delivery", days: [LAST_ALBUM_REMINDER] }, typical: true },
    summary: "When the agreement, balance, gallery, album, review ask, crew and insurance all check out, the job closes.",
    byItself: [{ text: "Checks every piece against the records and shows what's still open under **Closing the job**." }],
    youApprove: [
      { text: "Tap **Close and archive**. Anything that happened outside StudioCue: **Mark as done**." },
    ],
    couple: [{ text: "Nothing more to do." }],
    crew: [{ text: "The payment date you set shows on their closeout." }],
    video: null,
  },
];

/** Every moment's copy, for the label check. */
export function journeyText(stage: ExpectedStage): string[] {
  return [stage.summary, ...[...stage.byItself, ...stage.youApprove, ...stage.couple, ...(stage.crew ?? [])].flatMap((moment) => [moment.text, moment.note ?? ""])];
}

// ── Who it's for ─────────────────────────────────────────────────────────

/** Booked, and every state a booked job moves on to. */
const BOOKED_OR_LATER = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
]);

/**
 * Whether a studio has ever booked a job. Today offers this page only until
 * it has: after the first booking the studio is living it, not reading it.
 */
export function studioHasBookedAJob(projects: ReadonlyArray<Record<string, unknown>> | null | undefined): boolean {
  return (projects ?? []).some((project) => BOOKED_OR_LATER.has(String(project.state ?? "")));
}
