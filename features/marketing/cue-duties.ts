/**
 * What Cue, the studio's office manager, does: the single list the public
 * site draws on (docs/positioning-office-manager-plan-2026-10-06.md).
 *
 * The promise is "works around the clock, waits for you on what matters", so
 * each duty says which half it belongs to:
 *
 * - `on_its_own`: runs with nobody there (a scheduler, a trigger, an inbound
 *   email). Only these may appear in the Saturday log or next to "around the
 *   clock".
 * - `you_approve`: Cue prepares it and a person taps once.
 *
 * `runs` names the Cloud Function export that does the work;
 * tests/marketing-claims.test.ts checks each one is still exported from
 * functions/src/index.ts, so a duty can't outlive the code behind it. The
 * code-verified audit behind this list is in the plan above; when a duty
 * changes class, change it here and the pages follow.
 *
 * Deliberately absent (not built, so never implied): proposal follow-ups, answering a couple without a tap, the studio's own
 * inbox, rescheduling, pricing, paying crew, closing a job, and anything
 * done to the photos.
 */

export type DutyMode = "on_its_own" | "you_approve";

export type DutyAreaId = "inquiries" | "paperwork" | "money" | "crew" | "insurance" | "planning" | "after";

export const DUTY_AREAS: ReadonlyArray<{ id: DutyAreaId; title: string }> = [
  { id: "inquiries", title: "Inquiries" },
  { id: "paperwork", title: "Agreements" },
  { id: "money", title: "Getting paid" },
  { id: "crew", title: "Crew" },
  { id: "insurance", title: "Venues and insurance" },
  { id: "planning", title: "Planning and the wedding week" },
  { id: "after", title: "After the wedding" },
];

export type CueDuty = {
  id: string;
  area: DutyAreaId;
  mode: DutyMode;
  text: string;
  /** What the studio connects or sets up first, when the duty needs it. */
  needs?: string;
  /** The Cloud Function export that does it (functions/src/index.ts). */
  runs: string;
};

export const CUE_DUTIES = [
  // Inquiries
  {
    id: "inquiry_ack",
    area: "inquiries",
    mode: "on_its_own",
    text: "Acknowledges every inquiry from your website form, checks your date and tells you",
    runs: "publicLeadIntake",
  },
  {
    id: "inquiry_capture",
    area: "inquiries",
    mode: "on_its_own",
    text: "Turns inquiries forwarded from your inbox into jobs",
    needs: "Forwarding set up",
    runs: "sendgridInboundMessage",
  },
  {
    id: "inquiry_reply",
    area: "inquiries",
    mode: "you_approve",
    text: "Drafts your first reply, in your voice",
    runs: "publicLeadIntake",
  },
  {
    id: "inquiry_follow_up",
    area: "inquiries",
    mode: "you_approve",
    text: "Follows up with couples who go quiet, on day 3 and day 7",
    runs: "inquiryFollowUpScheduler",
  },
  {
    id: "consultation_booking",
    area: "inquiries",
    mode: "on_its_own",
    text: "Lets couples book, move or cancel their consultation themselves",
    needs: "Your availability",
    runs: "publicConsultationScheduling",
  },
  // Agreements
  {
    id: "agreement_prepared",
    area: "paperwork",
    mode: "on_its_own",
    text: "Writes the agreement from the accepted proposal",
    runs: "bookingProposalAccepted",
  },
  {
    id: "signing_reminders",
    area: "paperwork",
    mode: "on_its_own",
    text: "Reminds the couple to sign, on day 3 and day 7",
    runs: "contractReminderScheduler",
  },
  // Money
  {
    id: "retainer_invoice",
    area: "money",
    mode: "on_its_own",
    text: "Sends the retainer invoice from your QuickBooks once the agreement is signed",
    needs: "QuickBooks",
    runs: "bookingContractCompleted",
  },
  {
    id: "booked",
    area: "money",
    mode: "on_its_own",
    text: "Books the job when the retainer is paid: confirmation, calendar, folders",
    runs: "bookingRetainerPaid",
  },
  {
    id: "final_invoice",
    area: "money",
    mode: "on_its_own",
    text: "Raises the final balance invoice 28 days before the day",
    needs: "QuickBooks",
    runs: "finalInvoiceScheduler",
  },
  {
    id: "payment_reminder",
    area: "money",
    mode: "you_approve",
    text: "Drafts a reminder when a payment is late, and checks it's still owed before it goes",
    runs: "finalInvoiceScheduler",
  },
  // Crew
  {
    id: "crew_offers",
    area: "crew",
    mode: "you_approve",
    text: "Lines up crew offers, with the rate on them, when a job books",
    runs: "crewCommand",
  },
  {
    id: "crew_cascade",
    area: "crew",
    mode: "on_its_own",
    text: "Offers the job to the next person on your list when someone passes",
    runs: "crewCascadeExpiryScheduler",
  },
  {
    id: "crew_calendar",
    area: "crew",
    mode: "on_its_own",
    text: "Puts the job on their calendar when they say yes",
    needs: "Google Calendar",
    runs: "operationsTaskWorker",
  },
  {
    id: "call_times",
    area: "crew",
    mode: "on_its_own",
    text: "Sends crew their call times two days before",
    runs: "eventReminderScheduler",
  },
  // Venues and insurance
  {
    id: "coi_request",
    area: "insurance",
    mode: "you_approve",
    text: "Asks your agent for the venue's certificate 60 days out",
    needs: "Your insurance details",
    runs: "coiChaseScheduler",
  },
  {
    id: "coi_chase",
    area: "insurance",
    mode: "on_its_own",
    text: "Chases your agent until the certificate comes back",
    runs: "coiChaseScheduler",
  },
  {
    id: "coi_check",
    area: "insurance",
    mode: "on_its_own",
    text: "Reads the certificate and checks it against what the venue requires",
    runs: "sendgridInboundCoi",
  },
  {
    id: "coi_send",
    area: "insurance",
    mode: "you_approve",
    text: "Sends it on to the venue",
    runs: "planningCommand",
  },
  // Planning and the wedding week
  {
    id: "form_reminders",
    area: "planning",
    mode: "on_its_own",
    text: "Reminds couples about planning forms they haven't finished",
    runs: "questionnaireReminderScheduler",
  },
  {
    id: "details_lock",
    area: "planning",
    mode: "on_its_own",
    text: "Locks the wedding details four weeks out and asks the couple to confirm",
    runs: "finalDetailsScheduler",
  },
  {
    id: "week_before_note",
    area: "planning",
    mode: "on_its_own",
    text: "Sends the couple their week-before note",
    runs: "eventReminderScheduler",
  },
  {
    id: "schedule_confirmation",
    area: "planning",
    mode: "you_approve",
    text: "Prepares the schedule confirmation and the day-before checklist",
    runs: "lifecycleMessageScheduler",
  },
  // After the wedding
  {
    id: "review_ask",
    area: "after",
    mode: "on_its_own",
    text: "Asks for a review after the gallery goes out",
    needs: "Your review link",
    runs: "reviewRequestScheduler",
  },
  {
    id: "album_reminders",
    area: "after",
    mode: "on_its_own",
    text: "Reminds the couple to choose their album photos",
    runs: "albumReminderScheduler",
  },
] as const satisfies ReadonlyArray<CueDuty>;

export type CueDutyId = (typeof CUE_DUTIES)[number]["id"];

export function cueDuty(id: CueDutyId): CueDuty {
  const duty = CUE_DUTIES.find((item) => item.id === id);
  if (!duty) throw new Error(`Unknown Cue duty: ${id}`);
  return duty;
}

/**
 * An example Saturday: what Cue did while the photographer shot a wedding.
 * Every line is an `on_its_own` duty (held by the claims test); the times
 * are illustrative, which the page says.
 */
export const SATURDAY_LOG: ReadonlyArray<{ time: string; text: string; duty: CueDutyId }> = [
  {
    time: "9:42 am",
    text: "New inquiry from Priya and Sam for June 14. Your date is free. Acknowledged it, told you, and drafted your reply.",
    duty: "inquiry_ack",
  },
  { time: "11:05 am", text: "Reminded the Okafors to sign their agreement.", duty: "signing_reminders" },
  { time: "1:30 pm", text: "Marcus passed on the Lee wedding. Offered it to Dana, next on your list.", duty: "crew_cascade" },
  { time: "2:15 pm", text: "Chased your agent for the Willow Creek certificate.", duty: "coi_chase" },
  { time: "4:50 pm", text: "Dana said yes. The Lee wedding is on her calendar.", duty: "crew_calendar" },
  {
    time: "6:20 pm",
    text: "The certificate came in with $500,000 of cover. Willow Creek needs $1,000,000. Flagged it for you.",
    duty: "coi_check",
  },
  { time: "7:10 pm", text: "Reminded the Parks about the planning form they haven't finished.", duty: "form_reminders" },
  { time: "8:00 pm", text: "Sent next Saturday's couple their week-before note.", duty: "week_before_note" },
];

/** What waits for the photographer on Monday: prepared, one tap each. */
export const MONDAY_WAITING: ReadonlyArray<{ text: string; duty: CueDutyId }> = [
  { text: "Your reply to Priya and Sam", duty: "inquiry_reply" },
  { text: "The Willow Creek certificate: send it, or ask your agent to fix it", duty: "coi_send" },
  { text: "The Lees' schedule confirmation", duty: "schedule_confirmation" },
  { text: "Crew offers for the Nguyen wedding, booked Saturday night", duty: "crew_offers" },
  { text: "A reminder to the Parks: their balance is a week late", duty: "payment_reminder" },
];

/** What Cue never does, whatever it is asked (CLAUDE.md's AI boundary, in plain words). */
export const CUE_NEVER: ReadonlyArray<{ title: string; text: string }> = [
  { title: "Signs anything", text: "Agreements are signed by people." },
  { title: "Records a payment", text: "That comes from QuickBooks, or from you." },
  { title: "Changes who can see what", text: "Permissions are yours alone." },
  { title: "Marks a job ready", text: "Fixed rules decide, never an AI guess." },
  { title: "Touches your photos", text: "Cue runs the office. The pictures are yours." },
];

/**
 * The hire comparison on the site: the US median wage for an administrative
 * assistant (BLS OEWS, SOC 43-6014, May 2025 data, as published on O*NET
 * OnLine). Update the figures and the year together.
 */
export const ASSISTANT_WAGE = {
  hourly: 22.86,
  annual: 47_540,
  occupation: "secretaries and administrative assistants",
  source: "U.S. Bureau of Labor Statistics, May 2025",
  url: "https://www.onetonline.org/link/localwages/43-6014.00",
} as const;

/** "about six and a half hours": what a monthly price buys at that wage, to the half hour. */
export function assistantHoursFor(monthlyDollars: number): string {
  const half = Math.round((monthlyDollars / ASSISTANT_WAGE.hourly) * 2) / 2;
  const whole = Math.floor(half);
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen"];
  const name = words[whole] ?? String(whole);
  return half === whole ? `${name} hours` : `${name} and a half hours`;
}
