import { TRADE_LABELS, tradeProfile, tradeVocab } from "../trades/trades.js";
import { COVERAGE_ROLES, coverageRoleLabel, type CoverageRole } from "../packages/coverage.js";

/**
 * "photography " for a photographer's client, nothing for a DJ's, makeup
 * artist's or hair stylist's (trades.ts): their client's inbox preview and
 * footer read "your project", never "your photography project" (UAT, 2026-10-09).
 */
const photoWord = (values: Record<string, unknown> | undefined, word = "photography "): string =>
  tradeProfile(values?.trade).family === "photo" ? word : "";
import { releaseHeadline } from "../post-event/deliverables.js";
import { bookingGateNeeds, jobKindOf, journeyProfile, vocab } from "../job-kinds/job-kinds.js";
import { bulletLinePattern, clientEmailParagraphs } from "./email-content.js";

/**
 * Account-security mail sent by the PLATFORM, not a studio: email verification
 * and password reset. These must never wear a tenant's letterhead — the person
 * receiving a "verify your StudioCue email" has, from their point of view, an
 * account with StudioCue, and may not recognise (or may distrust) a studio brand
 * on it. So the render is fed a platform brand and the send disables SendGrid
 * click/open tracking, because an auth link wrapped in a `ct.sendgrid.net`
 * redirect is phishing-adjacent and breaks if tracking has an outage. Every
 * other template legitimately names the studio (a studio IS inviting the client
 * / sending the proposal), so this stays deliberately narrow.
 */
export const AUTH_EMAIL_TYPES = [
  "email_verification",
  "password_reset",
  "sign_in_link",
] as const;

export const isAuthEmailType = (type: string): boolean =>
  (AUTH_EMAIL_TYPES as readonly string[]).includes(type);

/**
 * Feedback mail (functions/src/feedback): between a studio and the StudioCue
 * team. Platform mail like auth — StudioCue's letterhead, never the studio's —
 * but it keeps ordinary tracking: there is no security link in it to protect.
 */
export const FEEDBACK_EMAIL_TYPES = [
  "feedback_received",
  "feedback_thanks",
  "feedback_planned",
  "feedback_shipped",
] as const;

/**
 * The StudioCue team writing to a studio from the Console (docs/console.md):
 * a one-off message from a studio's record, and a reply to a piece of their
 * feedback. Platform mail, signed by the team, never by a person.
 */
export const TEAM_EMAIL_TYPES = ["platform_message", "feedback_reply"] as const;

/**
 * StudioCue's own sales mail. To the team inbox when a photographer asks for a
 * demo on studio-cue.com/demo (app/api/public/demo); and to a vendor on a
 * studio's booked job, inviting them to try StudioCue with that studio's
 * referral code (saas/vendor-invites.ts). Platform mail.
 */
export const GROWTH_EMAIL_TYPES = ["platform_demo_requested", "platform_vendor_invite"] as const;

/**
 * StudioCue writing to a studio owner about their own subscription
 * (saas/billing-notices.ts). Platform mail: StudioCue's letterhead, and never
 * held when a studio's billing lapses — it is how they find out.
 */
export const BILLING_EMAIL_TYPES = [
  "billing_trial_ending",
  "billing_payment_failed",
  "billing_payment_recovered",
  "billing_referral_credit",
] as const;

/**
 * "Cue's first two weeks": StudioCue writing to a studio owner during the
 * trial (saas/trial-series.ts). Platform mail, like billing: StudioCue's
 * letterhead, sent by the billing scheduler, and never to a client.
 */
export const TRIAL_EMAIL_TYPES = [
  "trial_cue_starts",
  "trial_cue_so_far",
  "trial_cue_without_asking",
] as const;

/** Sent by StudioCue itself rather than by a studio. */
export const isPlatformEmailType = (type: string): boolean =>
  isAuthEmailType(type) ||
  (FEEDBACK_EMAIL_TYPES as readonly string[]).includes(type) ||
  (TEAM_EMAIL_TYPES as readonly string[]).includes(type) ||
  (GROWTH_EMAIL_TYPES as readonly string[]).includes(type) ||
  (BILLING_EMAIL_TYPES as readonly string[]).includes(type) ||
  (TRIAL_EMAIL_TYPES as readonly string[]).includes(type);

export const emailTemplateKeys = [
  "staff_invitation",
  "client_invitation",
  "crew_invitation",
  "crew_directory_invitation",
  "email_verification",
  "password_reset",
  "sign_in_link",
  "inquiry_acknowledgement",
  "consultation_confirmation",
  "consultation_invitation",
  "consultation_reminder",
  // The studio moved or cancelled the couple's consultation.
  "consultation_rescheduled",
  "consultation_cancelled",
  "package_follow_up",
  "proposal_sent",
  "contract_sent",
  // StudioCue's own contracts (functions/src/contracts). The couple signs in
  // their portal, so every one of these links there.
  "contract_ready",
  "contract_reminder",
  "contract_signed",
  "contract_voided",
  // The studio recorded the couple's signature on an agreement signed another
  // way, which retired the one out for signature here: nothing left to sign.
  "contract_superseded",
  // The studio withdrew a booking change the couple had been sent to sign.
  "amendment_withdrawn",
  // Studio-facing: the couple signed.
  "studio_contract_signed",
  // Studio-facing: an accepted proposal's agreement is drafted and waiting
  // on the studio — to check, or to finish when a field is blank.
  "studio_contract_waiting",
  "retainer_invoice",
  "booking_confirmation",
  "questionnaire_request",
  "questionnaire_reminder",
  "coi_request",
  "coi_correction",
  "coi_venue_delivery",
  "crew_reminder",
  // Each crew member's monthly list of the jobs they've accepted (crew/monthly-roundup.ts).
  "crew_monthly_roundup",
  "crew_assignment_cancelled",
  // The studio called the wedding off and chose to tell the couple (Wave 3):
  // their own words, or a plain default. Never sent unless they tick it.
  "project_cancelled",
  "final_invoice",
  "final_payment_reminder",
  "billing_address_request",
  "final_details_request",
  "schedule_review",
  "final_schedule_published",
  "event_reminder",
  "thank_you",
  "delivery",
  // A delivery link the studio got wrong, put right (replaceDeliveryLink).
  "delivery_correction",
  "album_selection_reminder",
  // Two weeks before a gallery's downloads end (H4, Q25).
  "delivery_expiry_reminder",
  "review_request",
  "manual_message",
  // Studio-facing: a client wrote in and someone needs to know.
  "client_message_received",
  // Studio-facing: a booking completed itself (signed, retainer paid).
  "studio_booking_confirmed",
  // Client-facing autopay: the saved card was charged, or declined.
  "autopay_charged",
  "autopay_charge_failed",
  // A parent's receipt for their athlete's photos on a group event
  // (features/group-events/participants.ts).
  "participant_receipt",
  // Studio-facing: inbox capture has gone quiet — the forwarding filter may
  // have broken, and inquiries may be sitting unanswered in the inbox.
  "studio_capture_silent",
  // Studio-facing: a new inquiry arrived. Speed to the first reply wins
  // couples, and Today only helps a studio that happens to open it.
  "studio_new_inquiry",
  // Studio-facing: the couple asked for changes to the day plan (run of show)
  // in their portal. Queued by approveSchedule (functions/src/planning).
  "studio_schedule_changes_requested",
  // Studio-facing: the owner's own morning brief. Not a client note — it gets
  // its own framing rather than the "note from your studio" shell.
  "daily_digest",
  // Studio ⇄ StudioCue team (functions/src/feedback). Platform mail.
  "feedback_received",
  "feedback_thanks",
  "feedback_planned",
  "feedback_shipped",
  // StudioCue team → studio, from the Console. Platform mail.
  "platform_message",
  // studio-cue.com/demo → the team inbox. Platform mail.
  "platform_demo_requested",
  "feedback_reply",
  // StudioCue → studio owner, about their own subscription. Platform mail.
  "billing_trial_ending",
  "billing_payment_failed",
  "billing_payment_recovered",
  "billing_referral_credit",
  // StudioCue → a vendor on a studio's booked job: try StudioCue.
  "platform_vendor_invite",
  // StudioCue → studio owner during the trial: "Cue's first two weeks".
  "trial_cue_starts",
  "trial_cue_so_far",
  "trial_cue_without_asking",
] as const;

export type EmailTemplateKey = (typeof emailTemplateKeys)[number];

export type EmailBrand = {
  studioName: string;
  productName: string;
  accentColor: string;
  logoUrl: string | null;
  contactEmail: string | null;
  /** The studio's postal address (Email branding), for the footer. */
  postalAddress?: string | null;
};

/**
 * StudioCue's operator, for the footer when the studio has no postal address
 * of its own, and on platform mail. Mirrors LEGAL_ENTITY in
 * features/legal/legal.ts (tests/legal-pages.test.ts compares them).
 */
export const OPERATOR_FOOTER = "StudioCue is operated by FlawlessIQ LLC, 2 Green Village Rd, Suite 209, Madison, NJ 07940";

export type RenderEmailInput = {
  key: string;
  brand: EmailBrand;
  recipientName?: string | null;
  projectName?: string | null;
  values: Record<string, unknown>;
  template?: EmailTemplateOverride | null;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  /** The email exactly as sent, branded wrapper included. */
  text: string;
  /** Just the message, for surfaces that are not an inbox. */
  body: string;
};

type EmailCopy = {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  action?: { label: string; url: string };
  /**
   * A second, quieter link under the button.
   *
   * One email had to carry two destinations — the gallery a couple wants now
   * and the portal where the rest of their wedding lives — and giving them two
   * equal buttons would have made neither the obvious one.
   */
  secondaryAction?: { label: string; url: string };
  /**
   * More equal buttons, after the first. A release can carry photos and a
   * film, and each is its own thing to open (H4, docs/delivery-plan-2026-09-28.md).
   */
  moreActions?: Array<{ label: string; url: string }>;
  /**
   * What someone told the studio, as label/value rows, then their own words.
   *
   * The new-inquiry alert carried a name and a button, so a studio wanting to
   * answer from its own inbox had to open StudioCue first to learn what the
   * couple had asked. These sit under the paragraphs, before the button.
   */
  details?: Array<{ label: string; value: string }>;
  quote?: { label: string; text: string };
  note?: string;
};

export type EmailTemplateOverride = {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string | null;
  note: string | null;
  /**
   * "add": the studio's words go under the greeting, above StudioCue's own,
   * which still carry the dates, times, amounts and links each email is for.
   * "replace": the studio's words are the whole message (a version saved
   * before modes existed reads this way). Either way a blank field keeps
   * StudioCue's (GR, 2026-10-08: the editor showed placeholder copy, and a
   * saved body silently dropped every detail the email carried).
   */
  mode?: "add" | "replace";
};

const stringValue = (
  values: Record<string, unknown>,
  key: string,
): string => {
  const value = values[key];
  return typeof value === "string" ? value.trim() : "";
};

const recordValue = (
  values: Record<string, unknown>,
  key: string,
): Record<string, unknown> => {
  const value = values[key];
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const numberValue = (
  values: Record<string, unknown>,
  key: string,
): number | null => {
  const value = values[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const safeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
};

/**
 * A date or time as the reader's own clock shows it.
 *
 * The zone is not decoration. Without it, `Intl` formats a timestamp in the
 * host's zone — and the host is Cloud Functions, which runs in UTC. A couple
 * who picked 10:00 AM in New York was emailed "2:00 PM", and a second shooter
 * offered 1:00 PM to 11:30 PM was told "5:00 PM through 3:30 AM" the next
 * morning. The app itself was right all along; only the mail was wrong, which
 * is the worst way to be wrong — nobody opens the app to check a time they
 * have already been told.
 *
 * So every timestamp is formatted in the event's own zone, and says which zone
 * that is, because a crew member may be reading it in another one.
 */
const humanDate = (value: string, timeZone?: string | null): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  // A date-only string (YYYY-MM-DD) parses as UTC midnight; formatting it in
  // any other zone can slip it to the day before. Pin such values to UTC so the
  // calendar date is what was meant, on any host.
  const dateOnly = !value.includes("T");
  const format = (zone: string) => {
    const day = new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeZone: zone,
    }).format(date);
    if (dateOnly) return day;
    // Note: `timeZoneName` cannot be combined with `timeStyle` — Intl throws —
    // so the clock is formatted on its own and joined here.
    const clock = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: zone,
    }).format(date);
    return `${day} at ${clock}`;
  };
  try {
    return format(dateOnly ? "UTC" : (timeZone ?? "UTC"));
  } catch {
    // An unknown zone must never cost the reader their email.
    return format("UTC");
  }
};

/** The calendar day of a timestamp, in the event's zone: "June 12, 2027". */
const humanDay = (value: string, timeZone?: string | null): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: zone }).format(date);
  try {
    return format(timeZone ?? "UTC");
  } catch {
    return format("UTC");
  }
};

/** The clock of a timestamp, in the event's zone and naming it: "11:30 PM EDT". */
const humanClock = (value: string, timeZone?: string | null): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const format = (zone: string) =>
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
      timeZone: zone,
    }).format(date);
  try {
    return format(timeZone ?? "UTC");
  } catch {
    return format("UTC");
  }
};

const projectReference = (
  projectName: string | null | undefined,
): string => (projectName ? ` for ${projectName}` : "");

function templateValue(
  value: string,
  input: RenderEmailInput,
): string {
  const replacements: Record<string, string> = {
    studioName: input.brand.studioName,
    productName: input.brand.productName,
    recipientName: input.recipientName ?? "",
    projectName: input.projectName ?? "",
    portalUrl: stringValue(input.values, "portalUrl"),
    actionUrl: stringValue(input.values, "actionUrl"),
    invoiceUrl: stringValue(input.values, "invoiceUrl"),
    scheduleUrl: stringValue(input.values, "scheduleUrl"),
    galleryUrl: stringValue(input.values, "galleryUrl"),
  };
  return value.replace(
    /\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g,
    (_match, key: string) => replacements[key] ?? "",
  );
}

function customizedCopy(
  base: EmailCopy,
  input: RenderEmailInput,
): EmailCopy {
  const template = input.template;
  if (!template) return base;
  const own = (value: string | null | undefined, fallback: string) =>
    value?.trim() ? templateValue(value, input) : fallback;
  const theirs = template.paragraphs
    .map((paragraph) => templateValue(paragraph, input).trim())
    .filter(Boolean);
  const [first, ...rest] = base.paragraphs;
  const greeting = first && /^(hi|hello|dear|hey)\b/i.test(first) ? first : null;
  const paragraphs =
    template.mode === "add"
      ? greeting
        ? [greeting, ...theirs, ...rest]
        : [...theirs, ...base.paragraphs]
      : theirs.length
        ? theirs
        : base.paragraphs;
  return {
    subject: own(template.subject, base.subject),
    preheader: own(template.preheader, base.preheader),
    eyebrow: own(template.eyebrow, base.eyebrow),
    heading: own(template.heading, base.heading),
    paragraphs,
    action:
      base.action && template.actionLabel
        ? {
            label: templateValue(template.actionLabel, input),
            url: base.action.url,
          }
        : base.action,
    // A studio's own wording for the email never removes a link it carries,
    // or what the couple wrote.
    moreActions: base.moreActions,
    details: base.details,
    quote: base.quote,
    secondaryAction: base.secondaryAction,
    note: template.note?.trim() ? templateValue(template.note, input) : base.note,
  };
}

/** StudioCue's own wording for an email, before any studio's changes. */
export function defaultEmailCopy(input: RenderEmailInput): {
  subject: string;
  preheader: string;
  eyebrow: string;
  heading: string;
  paragraphs: string[];
  actionLabel: string | null;
  note: string | null;
} {
  const copy = withStudioCueLink(copyFor({ ...input, template: null }), { ...input, template: null });
  return {
    subject: copy.subject,
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    heading: copy.heading,
    paragraphs: copy.paragraphs,
    actionLabel: copy.action?.label ?? null,
    note: copy.note ?? null,
  };
}

type DeliveryEmailItem = {
  mediaType: string;
  kind: string;
  label: string;
  url: string;
  accessCode: string;
  expirationDate: string;
};

/** A delivery job's links, each through its view-tracking redirect when it has one. */
function deliveryItems(values: Record<string, unknown>): DeliveryEmailItem[] {
  const raw = Array.isArray(values.items) ? values.items : null;
  if (raw) {
    return raw.flatMap((entry) => {
      const item = recordValue({ item: entry }, "item");
      const url = safeUrl(stringValue(item, "openUrl")) || safeUrl(stringValue(item, "galleryUrl"));
      if (!url) return [];
      return [
        {
          mediaType: stringValue(item, "mediaType") || "photo",
          kind: stringValue(item, "kind") || "gallery",
          label: stringValue(item, "label") || "Your delivery",
          url,
          accessCode: stringValue(item, "accessCode"),
          expirationDate: stringValue(item, "expirationDate"),
        },
      ];
    });
  }
  const url = safeUrl(stringValue(values, "openUrl")) || safeUrl(stringValue(values, "galleryUrl"));
  return url
    ? [
        {
          mediaType: "photo",
          kind: "gallery",
          label: "Photo gallery",
          url,
          accessCode: stringValue(values, "accessCode"),
          expirationDate: stringValue(values, "expirationDate"),
        },
      ]
    : [];
}

/**
 * What an agent needs on the certificate beyond the holder: where the holder
 * is, the cover and limits, and the venue's wording. Walked on prod
 * 2026-09-29: the request named the holder and nothing else, so the agent
 * would have had to write back for the address.
 */
export function coiRequirementLines(requirement: Record<string, unknown>): string[] {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const lines: string[] = [];
  if (text(requirement.venueAddress)) lines.push(`Holder address: ${text(requirement.venueAddress)}.`);
  const coverage = Array.isArray(requirement.coverageTypes)
    ? (requirement.coverageTypes as unknown[]).map(String).filter(Boolean)
    : [];
  const limits = Object.entries((requirement.requiredLimits ?? {}) as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" && value > 0)
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase()} $${(Number(value) / 100).toLocaleString("en-US")}`);
  if (coverage.length || limits.length) {
    lines.push(`Coverage: ${[coverage.join(", "), limits.join(", ")].filter(Boolean).join(" — ")}.`);
  }
  if (text(requirement.additionalInsuredWording)) {
    lines.push(`Additional insured, worded exactly: "${text(requirement.additionalInsuredWording)}"`);
  }
  if (requirement.waiverOfSubrogation === true) lines.push("Include a waiver of subrogation.");
  if (requirement.primaryNoncontributory === true) lines.push("Include primary and noncontributory wording.");
  if (text(requirement.specialInstructions)) lines.push(text(requirement.specialInstructions));
  return lines;
}

/** The line under a release's heading. The studio's preview says the same. */
export function deliveryLine(count: number): string {
  return count > 1
    ? "Everything is below — each one opens in your browser."
    : "It's ready whenever you are — the button below opens it in your browser.";
}

function deliveryButton(item: DeliveryEmailItem): string {
  if (item.kind === "sneak_peek") return "See your sneak peek";
  if (item.mediaType === "video") return `Watch your ${item.label.toLowerCase().replace(/^your\s+/, "")}`;
  if (item.mediaType === "files") return "Download your files";
  return "Open your photographs";
}

/**
 * How to meet, for a consultation email.
 *
 * `joinUrl` is read from the consultation at send time
 * (booking/consultation-email.ts). A video call without one says the studio
 * will send the link, rather than "any final meeting details", which reads as
 * if there were nothing to wait for.
 */
function consultationMeetingDetails(values: Record<string, unknown>): {
  line: string;
  joinUrl: string;
} {
  const joinUrl = safeUrl(stringValue(values, "joinUrl"));
  const location = stringValue(values, "location");
  // The link is the button (and its line in the text version); writing it
  // here too sent it twice (prod walk, 2026-10-06).
  if (joinUrl) return { joinUrl, line: "It's a video call. Join with the button below at the time." };
  if (values.meetingDetailsPending === true)
    return {
      joinUrl: "",
      line: "It's a video call — we'll send you the link to join before the appointment.",
    };
  if (stringValue(values, "meetingMode") === "phone")
    return {
      joinUrl: "",
      line: location
        ? `We'll call you on ${location}.`
        : "We'll call you at the number you gave us.",
    };
  if (location) return { joinUrl: "", line: `Location or meeting details: ${location}` };
  return { joinUrl: "", line: "We'll share any final meeting details before the appointment." };
}

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** What Cue did during a trial, as saas/trial-series.ts counts it. */
export type TrialActivityCounts = {
  inquiries: number;
  acknowledged: number;
  reminders: number;
  emailsSent: number;
  drafted: number;
  approved: number;
  waiting: number;
};

const TRIAL_ACTIVITY_KEYS = ["inquiries", "acknowledged", "reminders", "emailsSent", "drafted", "approved", "waiting"] as const;

function trialActivityFrom(record: Record<string, unknown>): TrialActivityCounts | null {
  if (!TRIAL_ACTIVITY_KEYS.some((key) => key in record)) return null;
  const count = (key: (typeof TRIAL_ACTIVITY_KEYS)[number]) => {
    const value = Number(record[key]);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  };
  return Object.fromEntries(TRIAL_ACTIVITY_KEYS.map((key) => [key, count(key)])) as TrialActivityCounts;
}

/**
 * The day-2 email's list: one line per thing that happened, none for what
 * didn't. Real counts only; a zero is left out, never dressed up.
 */
export function trialActivityLines(activity: TrialActivityCounts): string[] {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const lines: string[] = [];
  if (activity.inquiries) lines.push(n(activity.inquiries, "inquiry came in", "inquiries came in"));
  if (activity.acknowledged) {
    lines.push(`${n(activity.acknowledged, "inquiry", "inquiries")} acknowledged by Cue on its own, with the date checked`);
  }
  if (activity.reminders) lines.push(`${n(activity.reminders, "reminder", "reminders")} sent on schedule`);
  if (activity.emailsSent) {
    lines.push(`${n(activity.emailsSent, "email", "emails")} sent for you in all, to clients, crew and venues`);
  }
  if (activity.drafted) {
    lines.push(
      `${n(activity.drafted, "draft", "drafts")} prepared for you${activity.approved ? `, ${activity.approved} approved` : ""}`,
    );
  }
  return lines.map((line) => `- ${line}`);
}

/** "GR Productions’" and "Alder & Muse’s": a name ending in s takes the apostrophe alone. */
/** A booked call by its purpose, in the studio's trade's words (trades.ts). */
function callNameFor(values: Record<string, unknown>): string {
  const purpose = typeof values.purpose === "string" ? values.purpose : "";
  const words = tradeVocab(values.trade);
  if (purpose === "final_details") return words.finalCall;
  if (purpose === "trial") return words.trial ?? "Trial";
  // A makeup artist or hair stylist has no sales consultation (trades.ts): a
  // call they book anyway is just a call, never "your consultation".
  return tradeProfile(values.trade).consultation ? words.consultation : "Call";
}

function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}’` : `${name.trim()}’s`;
}

function copyFor(input: RenderEmailInput): EmailCopy {
  const { brand, values } = input;
  // The event's own zone, put on the job by the sender (see emailContext).
  const zone = stringValue(values, "timezone") || null;
  const recipient = input.recipientName?.trim();
  const greeting = recipient ? `Hi ${firstNameOf(recipient)},` : "Hello,";
  const project = projectReference(input.projectName);
  const inviteUrl = safeUrl(stringValue(values, "inviteUrl"));
  const actionUrl = safeUrl(stringValue(values, "actionUrl"));
  const destinationUrl = safeUrl(stringValue(values, "destinationUrl"));
  const invoiceUrl = safeUrl(stringValue(values, "invoiceUrl"));
  const portalUrl = safeUrl(stringValue(values, "portalUrl"));
  const scheduleUrl = safeUrl(stringValue(values, "scheduleUrl"));
  const galleryUrl = safeUrl(stringValue(values, "galleryUrl"));
  const requirement = recordValue(values, "requirement");

  switch (input.key as EmailTemplateKey) {
    case "staff_invitation":
      return {
        subject: `You’re invited to ${brand.studioName} on StudioCue`,
        preheader: "Accept your secure workspace invitation.",
        eyebrow: "Workspace invitation",
        heading: `Join ${brand.studioName}`,
        paragraphs: [
          greeting,
          `We've invited you to help manage our ${photoWord(values)}operations in StudioCue.`,
          "Use the invited email address when you create or sign in to your account.",
        ],
        action: inviteUrl
          ? { label: "Accept workspace invitation", url: inviteUrl }
          : undefined,
        note: "This secure invitation expires after seven days.",
      };
    case "client_invitation":
      return {
        subject: `${brand.studioName} invited you to your client portal`,
        preheader: `Your secure ${photoWord(values)}project portal is ready.`,
        eyebrow: "Client portal",
        heading: `Your project space is ready`,
        paragraphs: [
          greeting,
          `We created a private portal${project} where you can see next steps, complete questionnaires, review the schedule, and access approved documents.`,
          "Activate access using the same email address that received this invitation.",
        ],
        action: inviteUrl
          ? { label: "Activate client portal", url: inviteUrl }
          : undefined,
        note:
          "For your security, this link expires after seven days and can be revoked by the studio.",
      };
    case "crew_invitation":
      {
        // A role written as its id ("makeup_artist") reads as its label.
        const roleValue = stringValue(values, "role");
        const role = (COVERAGE_ROLES as readonly string[]).includes(roleValue)
          ? ((label: string) => `${label.charAt(0).toUpperCase()}${label.slice(1)}`)(coverageRoleLabel(roleValue as CoverageRole, 1))
          : roleValue;
        const arrivalAt = stringValue(values, "arrivalAt");
        const departureAt = stringValue(values, "departureAt");
        const respondBy = stringValue(values, "respondBy");
        const locationName = stringValue(values, "locationName");
        const locationAddress = stringValue(values, "locationAddress");
        const compensationCents = numberValue(values, "compensationCents");
        const currency = stringValue(values, "currency") || "USD";
        const compensation =
          values.compensationVisibleToCrew === true && compensationCents !== null
            ? `${new Intl.NumberFormat("en-US", {
                style: "currency",
                currency,
              }).format(compensationCents / 100)}${
                stringValue(values, "compensationType") === "hourly"
                  ? " per hour"
                  : " total"
              }`
            : "Available in the secure assignment brief";
        const details = [
          role ? `Role: ${role}` : "",
          arrivalAt && departureAt
            ? `Time: ${humanDate(arrivalAt, zone)} through ${humanDate(departureAt, zone)}`
            : "",
          locationName
            ? `Location: ${locationName}${locationAddress ? ` — ${locationAddress}` : ""}`
            : "",
          `Compensation: ${compensation}`,
          respondBy ? `Please respond by ${humanDate(respondBy, zone)}.` : "",
        ].filter(Boolean);
      // The trade the role names: a videographer offered "a photography
      // assignment" reads it as the wrong email (GR Productions staffs both).
      const trade = /video|cinema|film/i.test(role) ? "video" : "photography";
      // A DJ's or a makeup artist's crew get their own trade's word (trades.ts).
      const studioTrade = tradeProfile(values.trade);
      const offerTrade =
        studioTrade.family === "photo" ? (trade === "video" ? "Video" : "Photography") : TRADE_LABELS[studioTrade.trade];
      // The same word in the sentence: "a makeup assignment", "a DJ assignment".
      const offerWord = studioTrade.family === "photo" ? trade : offerTrade === "DJ" ? "DJ" : offerTrade.toLowerCase();
      // The same offer again for the last name on the list, held open rather
      // than expired (crew/commands.ts, remindLastCandidate).
      const reminder = values.reminder === true;
      return {
        subject: `${reminder ? "Reminder: " : ""}${role ? `${role} — ` : ""}${offerTrade} assignment from ${brand.studioName}`,
        preheader: reminder
          ? "The studio is still holding this job for you."
          : respondBy
            ? `Review the job details and respond by ${humanDate(respondBy, zone)}.`
            : "Review and respond to your assignment.",
        eyebrow: reminder ? "Still waiting on you" : "Crew assignment",
        heading: reminder ? "Can you take this job?" : `A new assignment is ready`,
        paragraphs: [
          greeting,
          reminder
            ? `Just checking in about the ${offerWord} assignment${project}. ${brand.studioName} is still holding it for you — let them know either way.`
            : `We'd like you to review a ${offerWord} assignment${project}.`,
          ...details,
          "Open the secure job brief to review responsibilities and requirements before accepting or declining.",
        ],
        action: inviteUrl
          ? { label: "Review assignment", url: inviteUrl }
          : undefined,
        note: "The secure brief is the source of truth if we update this offer.",
      };
      }
    case "crew_directory_invitation":
      /**
       * Joining the roster, which is not the same as being offered a job.
       *
       * `crew_invitation` is an offer: it names a role, a date, a location and
       * a fee, and asks for a yes or a no. This one has no job attached — the
       * studio has added someone to their directory and wants them set up
       * before any work exists, so the ask is to create an account and fill in
       * the paperwork that would otherwise sit "missing" forever.
       */
      return {
        subject: `${brand.studioName} added you to their crew roster`,
        preheader: "Set up your profile so you're ready for the next job.",
        eyebrow: "Crew roster",
        heading: "You've been added to the crew",
        paragraphs: [
          greeting,
          `We've added you to our crew roster on StudioCue. There's no job attached to this yet — it means we'd like you ready for one.`,
          "Setting up your profile takes a few minutes: confirm your specialties and the areas you travel to, mark the dates you're free, and send over your W-9 and proof of insurance.",
          "Once that's done you'll see any assignment we offer you, with the schedule and the brief, in the same place.",
        ],
        action: inviteUrl
          ? { label: "Set up your crew profile", url: inviteUrl }
          : undefined,
        note:
          "For your security, this link expires after seven days and can be revoked by us.",
      };
    case "email_verification":
      return {
        subject: "Verify your StudioCue email",
        preheader: "Confirm your email to secure your account.",
        eyebrow: "Account security",
        heading: "Verify your email address",
        paragraphs: [
          greeting,
          "Confirm that this email belongs to you before accessing a StudioCue workspace or portal.",
        ],
        action: actionUrl
          ? { label: "Verify email address", url: actionUrl }
          : undefined,
        note:
          "If you did not create a StudioCue account, you can safely ignore this email.",
      };
    case "password_reset":
      return {
        subject: "Reset your StudioCue password",
        preheader: "Use this secure link to choose a new password.",
        eyebrow: "Account security",
        heading: "Choose a new password",
        paragraphs: [
          greeting,
          "We received a request to reset the password for your StudioCue account.",
        ],
        action: actionUrl
          ? { label: "Reset password", url: actionUrl }
          : undefined,
        note:
          "If you did not request this change, ignore this email. Your password will remain unchanged.",
      };
    case "sign_in_link":
      return {
        subject: "Your StudioCue sign-in link",
        preheader: "Open your portal with this secure one-time link.",
        eyebrow: "Account security",
        heading: "Sign in to your portal",
        paragraphs: [
          greeting,
          "Use the secure link below to open your StudioCue portal. No password needed — the link signs you in on this device.",
        ],
        action: actionUrl
          ? { label: "Open my portal", url: actionUrl }
          : undefined,
        note:
          "This link is single-use and expires shortly. If you did not request it, you can safely ignore this email.",
      };
    case "inquiry_acknowledgement":
      return {
        subject: `${brand.studioName} received your inquiry`,
        preheader: "Your inquiry is safely with us.",
        eyebrow: "Inquiry received",
        heading: "Thank you for reaching out",
        paragraphs: [
          greeting,
          `We received your inquiry and will review the event details before confirming availability or recommending a next step.`,
        ],
        action: portalUrl
          ? { label: "View your inquiry", url: portalUrl }
          : undefined,
      };
    case "consultation_confirmation":
    case "consultation_reminder":
    case "consultation_rescheduled": {
      // "final details call" for the call a month out (booking/consultation-purpose.ts).
      // A DJ's are a vibe call and a final planning call (trades.ts).
      const call = callNameFor(values).toLowerCase();
      const Call = call.charAt(0).toUpperCase() + call.slice(1);
      const startsAt = humanDate(stringValue(values, "startsAt"), zone);
      const isReminder = input.key === "consultation_reminder";
      const isMove = input.key === "consultation_rescheduled";
      // Their own inquiry page (/i/…): the same page shows, moves or cancels it.
      const rescheduleUrl = safeUrl(stringValue(values, "rescheduleUrl"));
      const details = consultationMeetingDetails(values);
      // The join link is the one thing they need on the day, so it is the
      // button whenever there is one; moving the call comes second.
      const primary = details.joinUrl
        ? { label: "Join the video call", url: details.joinUrl }
        : actionUrl
          ? { label: `View ${call}`, url: actionUrl }
          : undefined;
      const manage = rescheduleUrl
        ? { label: "Reschedule or cancel", url: rescheduleUrl }
        : undefined;
      return {
        subject: isMove
          ? `New time for your ${call} with ${brand.studioName}`
          : `${isReminder ? "Reminder: " : ""}${Call} with ${brand.studioName}`,
        preheader: isMove
          ? `Your ${call} has moved${startsAt ? ` to ${startsAt}` : ""}.`
          : isReminder
            ? `Your ${call} is coming up.`
            : `Your ${call} is confirmed.`,
        eyebrow: isMove
          ? `${Call} moved`
          : isReminder
            ? `${Call} reminder`
            : `${Call} confirmed`,
        heading: isMove
          ? `Your ${call} has a new time`
          : isReminder
            ? "We’ll see you soon"
            : `Your ${call} is booked`,
        paragraphs: [
          greeting,
          isMove
            ? `We've moved your ${call}${startsAt ? ` to ${startsAt}` : ""}. Everything else stays the same.`
            : `We${isReminder ? "'re looking forward to" : " confirmed"} your ${call}${startsAt ? ` on ${startsAt}` : ""}.`,
          details.line,
        ],
        action: primary ?? manage,
        secondaryAction: primary ? manage : undefined,
        note: manage
          ? undefined
          : "Need a different time? Reply to this email and we'll sort it out.",
      };
    }
    case "consultation_cancelled": {
      // A DJ's are a vibe call and a final planning call (trades.ts).
      const call = callNameFor(values).toLowerCase();
      const Call = call.charAt(0).toUpperCase() + call.slice(1);
      const startsAt = humanDate(stringValue(values, "startsAt"), zone);
      const rescheduleUrl = safeUrl(stringValue(values, "rescheduleUrl"));
      return {
        subject: `Your ${call} with ${brand.studioName} is canceled`,
        preheader: `Your ${call}${startsAt ? ` on ${startsAt}` : ""} is no longer happening.`,
        eyebrow: `${Call} canceled`,
        heading: `Your ${call} is canceled`,
        paragraphs: [
          greeting,
          `We've canceled your ${call}${startsAt ? ` on ${startsAt}` : ""}, so there's no need to join.`,
          rescheduleUrl
            ? "If you'd still like to talk, pick another time that suits you."
            : "If you'd still like to talk, reply to this email and we'll find another time.",
        ],
        action: rescheduleUrl
          ? { label: "Pick another time", url: rescheduleUrl }
          : undefined,
      };
    }
    case "consultation_invitation":
      // A makeup or hair trial, booked from the studio's link (trades.ts).
      if (stringValue(values, "purpose") === "trial")
        return {
          subject: `Book your ${callNameFor(values).toLowerCase()} with ${brand.studioName}`,
          preheader: "Pick a time to try your look before the day.",
          eyebrow: callNameFor(values),
          heading: "Let’s try your look",
          paragraphs: [
            greeting,
            `Pick a time for your ${callNameFor(values).toLowerCase()}${project}. Bring pictures of looks you love${tradeVocab(values.trade).trial === "Hair trial" ? ", your veil and any accessories" : ""}, and we'll get your look just right before the day.`,
            // A hair trial waits for the veil (trades.ts `trialHint`).
            ...(tradeVocab(values.trade).trialHint
              ? ["If you haven't chosen your veil yet, book once you have — we'll build the style around it."]
              : []),
          ],
          action: actionUrl ? { label: "Pick a time", url: actionUrl } : undefined,
          note: "Times remain available until someone else books them.",
        };
      // The details lock sends this one with the final-details email; a studio
      // can also send it by hand (planning/final-details.ts).
      if (stringValue(values, "purpose") === "final_details")
        return {
          subject: `Book your ${tradeVocab(values.trade).finalCall.toLowerCase()} with ${brand.studioName}`,
          preheader: "A short call to go over your final details and timeline.",
          eyebrow: tradeVocab(values.trade).finalCall,
          heading: "Let’s go over the final details",
          paragraphs: [
            greeting,
            `Your day is close! Pick a time for a short call${project} — we'll go over your final details and timeline together and make any last changes.`,
          ],
          action: actionUrl ? { label: "Pick a time", url: actionUrl } : undefined,
          note: "Times remain available until someone else books them.",
        };
      return {
        subject: `Choose a ${callNameFor(values).toLowerCase()} time with ${brand.studioName}`,
        preheader: tradeProfile(values.trade).family === "photo"
          ? "Select a convenient time for your photography consultation."
          : `Select a convenient time for your ${callNameFor(values).toLowerCase()}.`,
        eyebrow: `${callNameFor(values)} invitation`,
        heading: "Let’s find a time to talk",
        paragraphs: [
          greeting,
          `We'd like you to choose a ${callNameFor(values).toLowerCase()} time${project}.`,
          "Open the secure scheduler to see our current availability. A confirmation will be sent after you choose a time.",
        ],
        action: actionUrl
          ? { label: `Choose a ${callNameFor(values).toLowerCase()} time`, url: actionUrl }
          : undefined,
        note: "Times remain available until another client confirms them.",
      };
    case "package_follow_up": {
      // A DJ's couple is choosing music packages, not photography (trades.ts).
      const photo = tradeProfile(values.trade).family === "photo";
      return {
        subject: photo ? `Photography options from ${brand.studioName}` : `Your options from ${brand.studioName}`,
        preheader: photo ? "Review the coverage options prepared for your event." : "Review the packages prepared for your event.",
        eyebrow: photo ? "Your photography options" : "Your options",
        // A vendor's packages are services, not coverage (trades.ts `coverage`).
        heading: photo ? "Let’s find the right coverage" : "Let’s find the right package",
        paragraphs: [
          greeting,
          `We've prepared the next step${project}. Review the available ${photo ? "coverage" : "packages"} and send any questions before making a selection.`,
        ],
        action: portalUrl
          ? { label: "Review packages", url: portalUrl }
          : undefined,
      };
    }
    case "proposal_sent": {
      // A makeup artist's or hair stylist's client gets a quote (trades.ts);
      // only a photographer's says photography.
      const offer = tradeVocab(values.trade).proposal.toLowerCase();
      const photo = tradeProfile(values.trade).family === "photo";
      return {
        subject: `Your ${offer} from ${brand.studioName}`,
        preheader: `Review your ${photo ? "photography " : ""}${offer} and pricing.`,
        eyebrow: `${offer.charAt(0).toUpperCase()}${offer.slice(1)} ready`,
        heading: `Your ${offer} is ready to review`,
        paragraphs: [
          greeting,
          `We've prepared a ${offer}${project} with your selected ${photo ? "coverage" : "services"}, pricing, payment schedule, and terms summary.`,
          `Review the live ${offer} in your secure client portal. A PDF copy is attached for your records.`,
        ],
        action: actionUrl
          ? { label: `Review ${offer}`, url: actionUrl }
          : undefined,
        // What accepting does depends on the kind of job (job-kinds.ts): a
        // family session pays to book, a sports day just books — "those
        // steps remain separate" told them about a contract that never comes.
        note: (() => {
          const kindValue = stringValue(values, "eventKind");
          if (!kindValue) return `Accepting a ${offer} does not sign a contract or collect a payment. Those steps remain separate.`;
          const needs = bookingGateNeeds(
            journeyProfile(jobKindOf({ eventKind: kindValue }), { payment: stringValue(values, "paymentShape") || undefined }),
          );
          return needs.agreement
            ? `Accepting a ${offer} does not sign a contract or collect a payment. Those steps remain separate.`
            : needs.payment
              ? `Accepting the ${offer} sends your invoice, and paying it books your date.`
              : `Accepting the ${offer} books your date.`;
        })(),
      };
    }
    case "contract_sent":
      return {
        subject: `Agreement ready from ${brand.studioName}`,
        preheader: `Review and sign your ${tradeProfile(values.trade).family === "photo" ? "photography " : ""}agreement.`,
        eyebrow: "Agreement ready",
        heading: "Your agreement is ready to sign",
        paragraphs: [
          greeting,
          `We sent the ${tradeProfile(values.trade).family === "photo" ? "photography " : ""}agreement${project} through our secure signature provider.`,
        ],
        action: actionUrl
          ? { label: "Review agreement", url: actionUrl }
          : undefined,
        note:
          "StudioCue will not mark an agreement complete until the signature provider confirms completion.",
      };
    case "contract_ready": {
      const signerName = stringValue(values, "signerName");
      // A makeup artist's or hair stylist's client accepted a quote, and a
      // vendor's client booked services, not coverage (trades.ts).
      const offer = tradeVocab(values.trade).proposal.toLowerCase();
      const booked = tradeProfile(values.trade).family === "photo" ? "coverage" : "services";
      const oneLink = tradeProfile(values.trade).journey.oneLinkBooking;
      // The studio takes the deposit itself (no QuickBooks or Stripe): there
      // is no next screen to pay on. Omitted, as on older jobs: online.
      const payOnline = values.payOnline !== false;
      // One send, two signatures (H2): the terms and the price together,
      // before anything was accepted — not "the proposal you accepted".
      if (values.combined === true) {
        return {
          subject: `Your booking agreement from ${brand.studioName} is ready to sign`,
          preheader: `Your ${booked}, your price and the terms — read them and sign in one go.`,
          eyebrow: "Booking agreement",
          heading: "Your booking agreement is ready",
          paragraphs: [
            greeting,
            `Everything for your booking${project} is in one agreement: Part 1 is ${possessive(brand.studioName)} terms, Part 2 is your ${booked}, extras, total and payment schedule. You sign each part, and signing books it — there's no separate step to accept the ${offer}.`,
            // A vendor's client pays the deposit on the next screen of the
            // same visit (simpler vendor journeys): one link books the date.
            oneLink && payOnline
              ? signerName
                ? `${signerName} has already signed both parts for ${brand.studioName}. Once you sign, you'll pay your deposit on the next screen — that books your date — and get a copy by email.`
                : "Once you sign, you'll pay your deposit on the next screen — that books your date — and get a copy by email."
              : oneLink
                ? `${signerName ? `${signerName} has already signed both parts for ${brand.studioName}. ` : ""}Once you sign, you'll get a copy by email, and ${brand.studioName} will arrange your deposit with you — paying it books your date.`
                : signerName
                  ? `${signerName} has already signed both parts for ${brand.studioName}. Once you sign, you'll get a copy by email and the next step is your retainer.`
                  : "Once you sign, you'll get a copy by email and the next step is your retainer.",
          ],
          action: actionUrl
            ? { label: oneLink && payOnline ? "Review and book" : "Read and sign", url: actionUrl }
            : portalUrl
              ? { label: oneLink && payOnline ? "Review and book" : "Read and sign", url: `${portalUrl.replace(/\/$/, "")}/contract` }
              : undefined,
          note: "Something to change? Reply to this email before you sign.",
        };
      }
      return {
        subject: `Your agreement from ${brand.studioName} is ready to sign`,
        preheader: "Read it and sign in your client portal — it takes a couple of minutes.",
        eyebrow: "Agreement ready",
        heading: "Your agreement is ready to sign",
        paragraphs: [
          greeting,
          `Your agreement${project} is ready. It's written from the ${offer} you accepted, so the package, price and payment schedule are the ones you agreed to.`,
          signerName
            ? `${signerName} has already signed for ${brand.studioName}. Once you sign, your agreement is complete and you'll get a copy by email.`
            : `Once you sign, your agreement is complete and you'll get a copy by email.`,
        ],
        action: actionUrl
          ? { label: "Read and sign", url: actionUrl }
          : portalUrl
            ? { label: "Read and sign", url: `${portalUrl.replace(/\/$/, "")}/contract` }
            : undefined,
        note: "You'll sign by typing your name. Questions about the agreement? Reply to this email before you sign.",
      };
    }
    case "contract_reminder":
      return {
        subject: `Reminder: your agreement from ${brand.studioName} is waiting`,
        preheader: "Your date is held once the agreement is signed.",
        eyebrow: "Agreement waiting",
        heading: "Your agreement is still waiting for you",
        paragraphs: [
          greeting,
          `A quick reminder that your agreement${project} is ready to sign in your client portal.`,
          "If anything in it needs changing, reply to this email and we'll sort it out before you sign.",
        ],
        action: portalUrl
          ? { label: "Read and sign", url: `${portalUrl.replace(/\/$/, "")}/contract` }
          : undefined,
      };
    case "contract_signed":
      return {
        subject: `Your signed agreement with ${brand.studioName}`,
        preheader: "Your copy of the signed agreement is attached.",
        eyebrow: "Agreement signed",
        heading: "Your agreement is signed",
        paragraphs: [
          greeting,
          `Thank you for signing${project}. Your copy of the complete agreement is attached — both signatures, and a record of when and how each was made.`,
          "It's also saved in your client portal whenever you need it.",
        ],
        action: portalUrl
          ? { label: "Open your client portal", url: `${portalUrl.replace(/\/$/, "")}/contract` }
          : undefined,
        note: "Keep this email for your records. You can ask us for a paper copy at any time.",
      };
    case "contract_voided":
      return {
        subject: `Your agreement from ${brand.studioName} was withdrawn`,
        preheader: "Please don't sign the earlier version — a new one is on its way.",
        eyebrow: "Agreement withdrawn",
        heading: "We withdrew your agreement",
        paragraphs: [
          greeting,
          `We withdrew the agreement we sent${project}, so it can no longer be signed.`,
          "We'll send an updated agreement shortly. If you have questions in the meantime, just reply to this email.",
        ],
      };
    case "contract_superseded":
      return {
        subject: `Nothing more to sign for ${brand.studioName}`,
        preheader: "We have your signed agreement, so the copy we sent you to sign online isn't needed.",
        eyebrow: "Agreement recorded",
        heading: "You're all signed",
        paragraphs: [
          greeting,
          `We've recorded your signature on the agreement${project} you signed with us another way, so the copy we sent you to sign online is no longer needed. There's nothing more for you to sign.`,
          "The next step is your retainer, and we'll be in touch about it. Questions? Just reply to this email.",
        ],
        action: portalUrl ? { label: "Open your client portal", url: portalUrl } : undefined,
      };
    case "amendment_withdrawn": {
      const changes = Array.isArray(values.changes)
        ? values.changes.filter((line): line is string => typeof line === "string" && line.trim() !== "")
        : [];
      return {
        subject: `${brand.studioName} withdrew the change to your booking`,
        preheader: "Your booking stands exactly as it was, and there's nothing to sign.",
        eyebrow: "Change withdrawn",
        heading: "The change to your booking was withdrawn",
        paragraphs: [
          greeting,
          changes.length
            ? `We've withdrawn the change to your booking${project} that we sent you to sign:`
            : `We've withdrawn the change to your booking${project} that we sent you to sign.`,
          // Its own paragraph, so it renders as a list (paragraphHtml).
          ...(changes.length ? [changes.map((line) => `• ${line}`).join("\n")] : []),
          "Your booking stands exactly as it was, and there's nothing for you to sign. If anything needs to change later, we'll send it to you fresh.",
          "Questions? Just reply to this email.",
        ],
        action: portalUrl ? { label: "Open your client portal", url: portalUrl } : undefined,
      };
    }
    case "studio_contract_signed": {
      const clientName = stringValue(values, "clientName") || "Your client";
      return {
        subject: `${clientName} signed the agreement${project}`,
        preheader: "The agreement is complete. The retainer is the next step.",
        eyebrow: "Agreement signed",
        heading: `${clientName} signed`,
        paragraphs: [
          `${clientName} signed the agreement${project}, so it is complete.`,
          tradeProfile(values.trade).journey.oneLinkBooking
            ? values.retainerAutomatic === true
              ? "They pay the deposit straight after signing; the job books itself when it's paid."
              : "Raise the deposit invoice on the job so they can pay it; the booking confirms when it's paid."
            : values.retainerAutomatic === true
              ? "StudioCue is raising the retainer invoice now, and the job books itself when it's paid."
              : "The retainer is next. When it's paid, record it on the job and the booking confirms.",
        ],
        action: actionUrl ? { label: "Open the job", url: actionUrl } : undefined,
      };
    }
    case "studio_contract_waiting": {
      const clientName = stringValue(values, "clientName") || "Your client";
      const reason = stringValue(values, "reason");
      const missing = Array.isArray(values.missingFields)
        ? values.missingFields.filter((field): field is string => typeof field === "string" && Boolean(field.trim()))
        : [];
      const list = (items: string[]) =>
        items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
      // A makeup or hair studio sends quotes (trades.ts).
      const offer = tradeVocab(values.trade).proposal.toLowerCase();
      return {
        subject:
          reason === "review"
            ? `${clientName} accepted — the agreement is ready to send${project}`
            : `${possessive(clientName)} agreement is waiting on you${project}`,
        preheader:
          reason === "needs_fields" && missing.length
            ? `It's missing: ${list(missing)}.`
            : `${clientName} accepted the ${offer} and is waiting for the agreement.`,
        eyebrow: "Agreement",
        heading: reason === "review" ? "The agreement is ready" : "The agreement needs you",
        paragraphs: [
          `${clientName} accepted the ${offer}${project}, and StudioCue drafted the agreement from it.`,
          reason === "needs_fields"
            ? `It wasn't sent automatically because it's missing: ${missing.length ? list(missing) : "a detail only you can fill in"}. Fill that in and send it.`
            : reason === "signer_inactive"
              ? "It wasn't sent automatically because the person it's set to sign for the studio is no longer an owner or admin here. Check it and send it yourself."
              : "Check it over and send it.",
          `${clientName} hasn't received anything yet.`,
        ],
        action: actionUrl ? { label: "Open the agreement", url: actionUrl } : undefined,
      };
    }
    case "retainer_invoice":
    case "final_invoice":
    case "final_payment_reminder": {
      const isRetainer = input.key === "retainer_invoice";
      const isReminder = input.key === "final_payment_reminder";
      const label = isRetainer ? "retainer" : "final balance";
      return {
        subject: `${isReminder ? "Reminder: " : ""}${isRetainer ? "Retainer" : "Final invoice"} from ${brand.studioName}`,
        preheader: `Review your ${label} in the secure accounting portal.`,
        eyebrow: isReminder ? "Payment reminder" : "Invoice ready",
        heading: isReminder
          ? `Your ${label} is still due`
          : `Your ${label} invoice is ready`,
        paragraphs: [
          greeting,
          `We ${isReminder ? `have a gentle reminder about your ${label}${project}.` : `have your ${label} invoice ready${project}.`}`,
          "You can review the details and pay securely whenever you're ready.",
        ],
        action: invoiceUrl
          ? { label: "Open secure invoice", url: invoiceUrl }
          : undefined,
      };
    }
    case "booking_confirmation":
      return {
        subject: `You’re booked with ${brand.studioName}`,
        preheader: `Your ${photoWord(values)}project is officially booked.`,
        eyebrow: "Booking confirmed",
        heading: "Your date is officially booked",
        paragraphs: [
          greeting,
          `Your signed agreement and retainer are both in${project} — your date is secured.`,
          "Your portal keeps the next steps, planning details, documents, and schedule together in one place.",
        ],
        action: portalUrl
          ? { label: "Open client portal", url: portalUrl }
          : undefined,
      };
    case "questionnaire_request":
    case "questionnaire_reminder": {
      const reminder = input.key === "questionnaire_reminder";
      // A form they already filled in, asked again to look it over at the
      // studio's form date (planning-form-scheduler.ts, requestReview).
      if (!reminder && values.variant === "review") {
        const form = stringValue(values, "formName") || "your planning details";
        return {
          subject: `Anything changed? Your ${form.toLowerCase()} with ${brand.studioName}`,
          preheader: "Look over what you sent us and update anything that's changed.",
          eyebrow: "Time to check in",
          heading: "Has anything changed?",
          paragraphs: [
            greeting,
            `Thanks for filling in ${form.toLowerCase()}${project}. Plans move as the day gets closer, so take a minute to look it over and update any times, places or names that have changed. Your answers are saved; just change what's different.`,
          ],
          action: actionUrl ? { label: "Review my details", url: actionUrl } : undefined,
        };
      }
      // A DJ's planner or a makeup artist's party list, by its own name
      // (trades.ts `detailsForm`); a photographer's reads as it always did.
      const form = tradeVocab(values.trade).detailsForm;
      // A vendor's client fills in this one form and the plan of the day is
      // drawn from it (trades.ts `journey.oneForm`), so the request says so.
      const oneForm = tradeProfile(values.trade).journey.oneForm && form;
      const planName = tradeVocab(values.trade).planOfDay ?? "Plan";
      const planWord = `${planName.charAt(0).toLowerCase()}${planName.slice(1)}`;
      return {
        subject: `${reminder ? "Reminder: " : ""}Details needed by ${brand.studioName}`,
        preheader: form ? `Complete your ${form}.` : "Complete your photography project questionnaire.",
        eyebrow: form ? (reminder ? `${form} reminder` : form) : reminder ? "Questionnaire reminder" : "Planning questionnaire",
        heading: reminder
          ? "A few project details are still needed"
          : "Help us plan the details",
        paragraphs: [
          greeting,
          `We${reminder ? "'re still waiting for" : "'re ready to collect"} ${form ? `your ${form.toLowerCase()}` : "the planning information"}${project}. You can save your progress and return before submitting.`,
          ...(oneForm && !reminder
            ? [`It's the one form we need from you: we build your ${planWord} from it and send it to you, with nothing more to fill in or approve.`]
            : []),
        ],
        action: actionUrl
          ? { label: form ? `Complete your ${form.toLowerCase()}` : "Complete questionnaire", url: actionUrl }
          : undefined,
      };
    }
    case "coi_request": {
      // A chase is a follow-up, not the same request again (H3): the agent
      // should see at once that this is the second or third time of asking.
      const chaseNumber = Number(values.chaseNumber ?? 0);
      if (chaseNumber > 0) {
        const due = requirement.dueDate ? humanDate(String(requirement.dueDate)) : null;
        // Which follow-up this is, in so many words: an agent with three of
        // these in their inbox should know which is newest at a glance.
        const which = followUpOrdinal(chaseNumber);
        return {
          subject: `${which}: certificate for ${String(requirement.venueLegalName ?? "an upcoming event")}${due ? `, due ${due}` : ""}`,
          preheader: `${which} — a certificate of insurance is still needed.`,
          eyebrow: "Insurance document request",
          heading: `${which} on our certificate request`,
          paragraphs: [
            "Hello,",
            `Following up on the certificate of insurance for ${String(requirement.venueLegalName ?? "the venue")} on ${requirement.eventDate ? humanDate(String(requirement.eventDate)) : "the event date"}${due ? ` — we need it by ${due}` : ""}.`,
            `Certificate holder: ${String(requirement.certificateHolder ?? "See the original request")}.`,
            "Reply to this email with one PDF attachment and it reaches us directly.",
          ],
        };
      }
      return {
        subject: `Certificate of insurance request from ${brand.studioName}`,
        preheader: `A certificate is needed for an upcoming ${photoWord(values)}event.`,
        eyebrow: "Insurance document request",
        heading: "Please prepare a certificate of insurance",
        paragraphs: [
          // Not `greeting`: this one goes to the studio's insurance agent, and
          // the project greeting opened it "Hi Harper," — the couple's name.
          "Hello,",
          `We need a certificate for ${String(requirement.venueLegalName ?? "the venue")} on ${requirement.eventDate ? humanDate(String(requirement.eventDate)) : "the event date"}.`,
          `Certificate holder: ${String(requirement.certificateHolder ?? "See the attached requirements")}. Due: ${requirement.dueDate ? humanDate(String(requirement.dueDate)) : "as soon as possible"}.`,
          ...coiRequirementLines(requirement),
          "Reply to this email with one PDF attachment. We'll review the certificate before sending it to the venue.",
        ],
      };
    }
    case "coi_correction": {
      // A chase of a correction (planning/coi-chase-scheduler.ts) carries its
      // number; it used to resend the first correction word for word.
      const chaseNumber = Number(values.chaseNumber ?? 0);
      if (chaseNumber > 0) {
        const which = followUpOrdinal(chaseNumber);
        const due = requirement.dueDate ? humanDate(String(requirement.dueDate)) : null;
        return {
          subject: `${which}: corrected certificate for ${String(requirement.venueLegalName ?? "an upcoming event")}${due ? `, due ${due}` : ""}`,
          preheader: `${which} — the corrected certificate is still needed.`,
          eyebrow: "Correction requested",
          heading: `${which} on the corrected certificate`,
          paragraphs: [
            "Hello,",
            `We're still waiting on the corrected certificate${requirement.venueLegalName ? ` for ${String(requirement.venueLegalName)}` : ""}${requirement.eventDate ? ` on ${humanDate(String(requirement.eventDate))}` : ""}${due ? ` — we need it by ${due}` : ""}.`,
            `What needs correcting: ${stringValue(values, "reason") || "please contact the studio."}`,
            "Reply to this email with one corrected PDF attachment and it reaches us directly.",
          ],
        };
      }
      return {
        subject: `Certificate correction requested by ${brand.studioName}`,
        preheader: "The studio needs a corrected insurance certificate.",
        eyebrow: "Correction requested",
        heading: "Please revise the certificate",
        paragraphs: [
          // To the insurance agent, not the couple: `greeting` opened it
          // "Hi Harper," (walked 2026-09-30), as the request once did.
          "Hello,",
          `We reviewed the certificate you sent${requirement.venueLegalName ? ` for ${String(requirement.venueLegalName)}` : ""}${requirement.eventDate ? ` on ${humanDate(String(requirement.eventDate))}` : ""} and need a correction.`,
          `Studio review note: ${stringValue(values, "reason") || "Please contact the studio for the requested correction."}`,
          "Reply to this email with one corrected PDF attachment.",
        ],
      };
    }
    case "coi_venue_delivery":
      return {
        subject: `Approved certificate from ${brand.studioName}`,
        preheader: "The studio-approved certificate is attached.",
        eyebrow: "Certificate delivery",
        heading: "Approved certificate attached",
        paragraphs: [
          // To the venue: the project greeting would name the couple.
          "Hello,",
          `We reviewed and approved the attached certificate of insurance for ${stringValue(values, "venueName") || "your venue"}${stringValue(values, "eventDate") ? `, for the event on ${humanDate(stringValue(values, "eventDate"))}` : ""}.`,
        ],
      };
    case "crew_reminder": {
      /**
       * Two days before their call (communications/event-reminders.ts), to
       * each crew member who accepted: when, where, and the day sheet, which
       * is the point. The call time and place are the assignment's as the
       * email sends. This was once an "action needed" nudge nothing queued.
       */
      const role = stringValue(values, "role");
      const arrivalAt = stringValue(values, "arrivalAt");
      const departureAt = stringValue(values, "departureAt");
      const callDate = stringValue(values, "callDate");
      const locationName = stringValue(values, "locationName");
      const locationAddress = stringValue(values, "locationAddress");
      const destination = scheduleUrl || actionUrl;
      // "the getting-ready schedule" for a makeup or hair crew (trades.ts).
      const planWord = tradeVocab(values.trade).planOfDay;
      const planName = planWord ? `${planWord.charAt(0).toLowerCase()}${planWord.slice(1)}` : "run of show";
      const day = arrivalAt
        ? humanDay(arrivalAt, zone)
        : callDate
          ? humanDate(callDate, zone)
          : "";
      return {
        subject: `Reminder: your ${brand.studioName} job${project}${day ? ` on ${day}` : ""}`,
        preheader: arrivalAt
          ? `Call time ${humanDate(arrivalAt, zone)}.`
          : "Your day sheet for the job.",
        eyebrow: "Crew reminder",
        heading: "Your job is coming up",
        paragraphs: [
          greeting,
          `A reminder that you're working${project}${day ? ` on ${day}` : ""}.`,
          ...[
            role ? `Role: ${role}` : "",
            arrivalAt
              ? `Call time: ${humanDate(arrivalAt, zone)}${departureAt ? `, until ${humanClock(departureAt, zone)}` : ""}`
              : "",
            locationName
              ? `Where: ${locationName}${locationAddress ? ` — ${locationAddress}` : ""}`
              : "",
          ].filter(Boolean),
          values.runOfShowShared === true
            ? `The ${planName}, who to call and your part in the day are on your day sheet. It saves to your phone, so it opens with no signal.`
            : `The studio hasn't published the ${planName} yet. It will be on your day sheet as soon as they do — message them from the job if you need it sooner.`,
          // A makeup artist's or hair stylist's kit (trades.ts `kitChecklist`).
          ...(() => {
            const kit = tradeVocab(values.trade).kitChecklist;
            return kit ? [`${kit.title} — before you leave, check ${kit.items.join("; ")}.`] : [];
          })(),
        ],
        action: destination
          ? { label: "Open your day sheet", url: destination }
          : undefined,
        note: destination
          ? undefined
          : `Sign in to your ${brand.studioName} crew account to see your day sheet.`,
      };
    }
    case "crew_monthly_roundup": {
      /**
       * The first days of each month (crew/monthly-roundup.ts), to each crew
       * member with a job still ahead: every job they've accepted with this
       * studio, soonest first. "Once accepted they should be getting a
       * reminder every few months" (Albert, GR, 2026-10-07). The list is the
       * one read as the email sends.
       */
      const jobs = (Array.isArray(values.jobs) ? values.jobs : []).filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      );
      const listed = jobs.slice(0, 20);
      const more = jobs.length - listed.length;
      const shortDay = (date: string) => {
        const parsed = new Date(`${date}T12:00:00Z`);
        return Number.isNaN(parsed.valueOf())
          ? date
          : new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(parsed);
      };
      const count = jobs.length === 1 ? "one job" : `${jobs.length} jobs`;
      return {
        subject: `Your upcoming jobs with ${brand.studioName}`,
        preheader: jobs.length
          ? `You're booked for ${count}. The next is ${shortDay(stringValue(jobs[0]!, "date"))}.`
          : "The jobs you've accepted.",
        eyebrow: "Monthly reminder",
        heading: jobs.length === 1 ? "Your upcoming job" : "Your upcoming jobs",
        paragraphs: [
          greeting,
          `A monthly reminder of what you've accepted with ${brand.studioName}: ${count} still ahead, soonest first.`,
        ],
        details: [
          ...listed.map((entry) => {
            const role = stringValue(entry, "role");
            const arrivalAt = stringValue(entry, "arrivalAt");
            const where = stringValue(entry, "locationName");
            const entryZone = stringValue(entry, "timezone") || zone;
            return {
              label: shortDay(stringValue(entry, "date")),
              value: [
                stringValue(entry, "jobName") || "Your job",
                role,
                arrivalAt ? `call ${humanClock(arrivalAt, entryZone)}` : "",
                where,
              ]
                .filter(Boolean)
                .join(" · "),
            };
          }),
          ...(more > 0 ? [{ label: "And", value: `${more} more on your jobs page` }] : []),
        ],
        action: actionUrl ? { label: "Open your jobs", url: actionUrl } : undefined,
        note: `If anything here looks wrong, or you can no longer make a date, message ${brand.studioName} from the job.`,
      };
    }
    case "project_cancelled": {
      /**
       * Written by the studio on the cancel form, or this default. Says the
       * booking is off and nothing more: a refund, a kept retainer or a new
       * date is the studio's conversation, not a line StudioCue guesses at.
       */
      const body = stringValue(values, "customBody");
      return {
        subject: `Your booking with ${brand.studioName}${project} is canceled`,
        preheader: "Your booking has been canceled. Reply to this email with any questions.",
        eyebrow: "Booking canceled",
        heading: "Your booking is canceled",
        paragraphs: [
          greeting,
          ...(body
            ? clientEmailParagraphs(body)
            : [
                `As we discussed, your booking${project} is now canceled, and we won't send you any more reminders or invoices for it.`,
                "If you have any questions, or anything about this doesn't look right, just reply to this email.",
              ]),
        ],
      };
    }
    case "crew_assignment_cancelled": {
      /**
       * Only ever sent to somebody who had **accepted**. They have the date in
       * their diary and have turned other work down, so this says plainly that
       * it is off, gives the studio's reason where there is one, and does not
       * ask them to do anything — there is nothing left for them to do.
       */
      const why = stringValue(values, "reason");
      /**
       * The studio took this one person off a job that is still going ahead
       * (functions/src/crew/commands.ts, withdrawAssignment). The job-stopped
       * copy below says the event is off — true when a wedding is cancelled,
       * false here, and a crew member told a wedding was called off may say
       * so to the couple.
       */
      if (stringValue(values, "cause") === "withdrawn") {
        return {
          subject: `Released: your ${brand.studioName} assignment${project}`,
          preheader: "The studio no longer needs you for this job.",
          eyebrow: "Assignment withdrawn",
          heading: "You've been released from this job",
          paragraphs: [
            greeting,
            `${brand.studioName} has withdrawn your assignment${project}. You are no longer needed on the day, and nothing further is expected from you.`,
            ...(why ? [`The studio noted: ${why}`] : []),
            "If you added it to your calendar, open the attached calendar file and it will be removed.",
            "Please get in touch if you were counting on this date and want to talk it through.",
          ],
        };
      }
      return {
        subject: `Canceled: your ${brand.studioName} assignment${project}`,
        preheader: "This job is no longer going ahead.",
        eyebrow: "Assignment canceled",
        heading: "This job has been called off",
        paragraphs: [
          greeting,
          `The event${project} is no longer going ahead, so your assignment has been canceled. You are not needed on the day, and nothing further is expected from you.`,
          ...(why ? [`The studio noted: ${why}`] : []),
          "Please get in touch if you were counting on this date and want to talk it through.",
        ],
      };
    }
    case "schedule_review":
    case "final_schedule_published": {
      const final = input.key === "final_schedule_published";
      /**
       * A DJ's, makeup artist's or hair stylist's plan is published for the
       * client to read, with nothing to approve (trades.ts
       * `journey.scheduleApproval`; planning/schedule-lifecycle.ts): this is
       * the "here's the plan" note, in the trade's words. A photographer's
       * reads as it always did, below.
       */
      const readOnlyPlan = !tradeProfile(values.trade).journey.scheduleApproval;
      if (readOnlyPlan) {
        const planWords = tradeVocab(values.trade);
        const Plan = planWords.planOfDay ?? "Schedule";
        // "getting-ready schedule", "run of show & MC script": only the first letter drops.
        const plan = `${Plan.charAt(0).toLowerCase()}${Plan.slice(1)}`;
        // "The morning" → "morning", "The night" → "night".
        const day = planWords.dayName.replace(/^the /i, "").toLowerCase();
        return {
          subject: final ? `${Plan} published — ${brand.studioName}` : `Here's the plan for your ${day} — ${brand.studioName}`,
          preheader: final ? `Open the current ${plan}.` : `Your ${plan} is ready to read.`,
          eyebrow: Plan,
          heading: final ? `The ${plan} is published` : `Here's the plan for your ${day}`,
          paragraphs: [
            greeting,
            final
              ? `We've published the current ${plan}${project}. Please use this version on the day.`
              : `We've put together your ${plan}${project} from what you told us. There's nothing you need to do.`,
            final
              ? "Relevant crew may be asked to acknowledge changes."
              : "Keep it handy for the day, and message us if anything changes.",
          ],
          action: scheduleUrl ? { label: final ? `Open the ${plan}` : "See the plan", url: scheduleUrl } : undefined,
        };
      }
      return {
        // P20: the couple's portal offers no "approve" action — publishing is
        // the shared state — so this must not promise a review/approval step.
        // It shares the schedule and invites a message, nothing more.
        subject: `${final ? "Final schedule published" : "Your event-day schedule"} — ${brand.studioName}`,
        preheader: final
          ? "Open the current event-day schedule."
          : "Your event-day schedule is ready.",
        eyebrow: final ? "Final schedule" : "Event-day schedule",
        heading: final
          ? "The final schedule is published"
          : "Your event-day schedule is ready",
        paragraphs: [
          greeting,
          `We${final ? "'ve published the current event-day schedule" : "'ve shared your event-day schedule"}${project}.`,
          final
            ? "Please use this version on the event day. Relevant crew may be asked to acknowledge changes."
            : "Keep it handy for the day. Message us if anything needs to change.",
        ],
        action: scheduleUrl
          ? { label: final ? "Open final schedule" : "View schedule", url: scheduleUrl }
          : undefined,
      };
    }
    case "event_reminder": {
      /**
       * The week-of note (communications/event-reminders.ts); a studio's own
       * workflow rule may also send it the day before. The link is the point:
       * their timeline when one is published for them, else their portal.
       */
      const eventDate = stringValue(values, "eventDate");
      const eventKind = jobKindOf({ eventKind: stringValue(values, "eventKind") || null });
      const primary = scheduleUrl
        ? { label: "See your timeline", url: scheduleUrl }
        : portalUrl
          ? { label: "Open your portal", url: portalUrl }
          : undefined;
      // A makeup or hair studio's week-before email is its prep guide (trades.ts).
      const prepGuide = tradeVocab(values.trade).prepGuide;
      return {
        subject: prepGuide ? `Your prep guide from ${brand.studioName}` : `Your event with ${brand.studioName} is coming up`,
        preheader: prepGuide
          ? "How to arrive for your chair, and your getting-ready times."
          : scheduleUrl
            ? "Your timeline and the last few details, in one place."
            : "The last few details for your day, in your portal.",
        eyebrow: prepGuide ? "Your prep guide" : "Event reminder",
        heading: "We’re ready for your event",
        paragraphs: [
          greeting,
          `We're looking forward to your event${project}${eventDate ? ` on ${humanDate(eventDate, zone)}` : ""}. ${
            scheduleUrl
              ? "Your timeline is ready: please check the times and places"
              : "Your portal has everything we have for the day: please check it"
          }, and reply to this email if anything has changed.`,
          // A wedding's words exactly; every other kind its own (job-kinds.ts).
          // A family was being asked to hang up the wedding dress. Only for a
          // photographer: a DJ's couple has no dress to hang up for the DJ
          // (trades.ts; each trade's own prep comes with its journey).
          ...(prepGuide
            ? [`${prepGuide.lead}, please ${prepGuide.items.join("; ")}.`]
            : !tradeProfile(values.trade).clientDayBefore
            ? []
            : tradeVocab(values.trade).dayBefore
              ? [`${tradeVocab(values.trade).dayBefore!.lead}, it helps to have: ${tradeVocab(values.trade).dayBefore!.items.join("; ")}.`]
              : eventKind === "wedding"
              ? ["To help photography begin on time, please have the wedding dress on a hanger and keep the shoes, flowers, rings, and invitation suite together before we arrive."]
              : [`To help photography begin on time, it helps to have ready: ${vocab(eventKind).dayBeforeChecklist.join("; ")}.`]),
        ],
        action: primary,
        secondaryAction:
          scheduleUrl && portalUrl
            ? { label: "Your project portal", url: portalUrl }
            : undefined,
        note: primary
          ? undefined
          : `Sign in to your ${brand.studioName} client portal to see the details.`,
      };
    }
    case "thank_you":
      return {
        subject: `Thank you from ${brand.studioName}`,
        preheader: "Thank you for trusting us with your event.",
        eyebrow: "Thank you",
        heading: "It was a privilege to be there",
        paragraphs: [
          greeting,
          tradeProfile(values.trade).delivery
            ? `We're grateful for the trust you placed in us${project}. We'll keep your portal updated as post-production progresses.`
            : `We're grateful for the trust you placed in us${project}. We loved being part of it.`,
        ],
      };
    case "delivery": {
      /**
       * What went out, in its own words: "Your film is ready", "Your photos
       * and film are ready", a button for each. Every delivery email said
       * "photographs", and a video-led studio's highlight film arrived as
       * "Your photographs are ready" (H4, docs/delivery-plan-2026-09-28.md).
       * A job queued before items existed carries one gallery link, as before.
       */
      const items = deliveryItems(values);
      const headline = releaseHeadline(items);
      const note = stringValue(values, "note");
      const expiring = items
        .filter((item) => item.expirationDate && item.mediaType !== "video")
        .map((item) => item.expirationDate)
        .sort()[0];
      const codes = items
        .filter((item) => item.accessCode)
        .map((item) =>
          items.length > 1
            ? `${item.label} ${item.mediaType === "video" ? "password" : "access code"}: ${item.accessCode}`
            : `${item.mediaType === "video" ? "Password" : "Gallery access code"}: ${item.accessCode}`,
        );
      const [firstItem, ...otherItems] = items.filter((item) => item.url);
      return {
        subject: `${headline.subject} — ${brand.studioName}`,
        preheader: items.length > 1 ? "Everything below is yours to keep." : "Open your secure delivery.",
        eyebrow: "Delivery ready",
        heading: headline.heading,
        paragraphs: [
          greeting,
          ...(note ? [note] : []),
          // Walked on prod 2026-09-29: "We've finished this for Delivery Walk
          // Test. Keep any password private." — the job's internal name, and a
          // password warning on a film that had none.
          deliveryLine(items.length),
          ...codes,
          ...(codes.length ? [`Keep the ${codes.length > 1 ? "codes" : items.some((item) => item.accessCode && item.mediaType === "video") ? "password" : "code"} private.`] : []),
          ...(expiring
            ? [`Please download and back up your ${items.some((item) => item.mediaType === "photo") ? "photographs" : "files"} before ${humanDate(expiring, zone)}.`]
            : []),
        ],
        action: firstItem ? { label: deliveryButton(firstItem), url: firstItem.url } : undefined,
        moreActions: otherItems.map((item) => ({ label: deliveryButton(item), url: item.url })),
        // The gallery is what they want; the portal is where the rest of this
        // wedding lives — the album selections, the download confirmation that
        // closes the job, how long they have left. An email with only the
        // provider link leaves every one of those unreachable.
        secondaryAction: portalUrl
          ? { label: "Your project portal", url: portalUrl }
          : undefined,
      };
    }
    case "delivery_correction": {
      /**
       * One email, not a second "your photographs are ready" (Wave 2). It says
       * plainly that the earlier link was wrong, so a couple who already
       * opened it — perhaps onto someone else's gallery — knows why, and it
       * gives the right one. The old link forwards here too, but the email is
       * what they will act on.
       */
      const [item] = deliveryItems(values);
      const note = stringValue(values, "note");
      const what = item
        ? item.mediaType === "video"
          ? `your ${item.label.toLowerCase().replace(/^your\s+/, "")}`
          : item.mediaType === "files"
            ? "your files"
            : "your photographs"
        : "your delivery";
      return {
        subject: `The right link for ${what} — ${brand.studioName}`,
        preheader: "The link we sent earlier was wrong. This one is right.",
        eyebrow: "Corrected link",
        heading: "Sorry — here's the right link",
        paragraphs: [
          greeting,
          `The link we sent you earlier for ${what} was wrong. Please use the one below instead — the earlier link now brings you here too.`,
          ...(note ? [note] : []),
          ...(item?.accessCode
            ? [`${item.mediaType === "video" ? "Password" : "Access code"}: ${item.accessCode}. Keep it private.`]
            : []),
          ...(item?.expirationDate && item.mediaType !== "video"
            ? [`Please download and back up ${what} before ${humanDate(item.expirationDate, zone)}.`]
            : []),
        ],
        action: item ? { label: deliveryButton(item), url: item.url } : undefined,
        secondaryAction: portalUrl ? { label: "Your project portal", url: portalUrl } : undefined,
      };
    }
    case "delivery_expiry_reminder": {
      const expirationDate = stringValue(values, "expirationDate");
      const label = stringValue(values, "label") || "Photo gallery";
      return {
        subject: `Download your photographs before ${expirationDate ? humanDate(expirationDate, zone) : "they expire"}`,
        preheader: "Your gallery closes soon. Save your favorites now.",
        eyebrow: "Gallery reminder",
        heading: "Your gallery closes soon",
        paragraphs: [
          greeting,
          `Your ${label.toLowerCase()}${project} is open until ${expirationDate ? humanDate(expirationDate, zone) : "soon"}. Download everything you want to keep — and back it up somewhere safe.`,
        ],
        action: galleryUrl ? { label: "Open your gallery", url: galleryUrl } : undefined,
        secondaryAction: portalUrl ? { label: "Your project portal", url: portalUrl } : undefined,
      };
    }
    case "final_details_request": {
      /**
       * Four weeks out: the couple confirms their final details — every
       * location and time, and the timeline (planning/final-details.ts). The
       * link is the point; without one the copy still says where to go.
       *
       * In the studio's trade's words (trades.ts): a DJ's couple confirms the
       * night and books the final planning call; a makeup artist's or hair
       * stylist's client confirms the morning and the headcount, which can
       * grow but not shrink from here. A photographer's reads as it always did.
       */
      const finalWords = tradeVocab(values.trade);
      const finalTrade = tradeProfile(values.trade);
      /**
       * Priced per person (makeup, hair): no call and nothing to read through,
       * one question — still this many getting ready? — and one tap to say
       * yes (planning/final-details.ts sends `headcount` from the party list).
       * Anyone added goes on the party list first; nobody comes off it, as the
       * agreement says (contracts/event-details.ts `headcountLock`).
       */
      if (finalTrade.perPersonPricing) {
        const counted = Number(values.headcount);
        const people = Number.isInteger(counted) && counted > 0 ? counted : null;
        const who = people === 1 ? "person" : "people";
        return {
          subject: people
            ? `Still ${people} getting ready? Please confirm with ${brand.studioName}`
            : `Who's getting ready? Please confirm with ${brand.studioName}`,
          preheader: "One tap to confirm your final headcount.",
          eyebrow: "Final headcount",
          heading: people ? `Still ${people} ${who} getting ready?` : "Who's getting ready?",
          paragraphs: [
            greeting,
            people
              ? `Your party list${project} has ${people} ${who} getting ready for your morning. If that's still everyone, one tap confirms it.`
              : `Your party list${project} has nobody on it yet. Add everyone getting ready for your morning, then confirm.`,
            "If anyone's been added, put them on your party list first. From here, people can be added but not taken off, as your agreement says.",
          ],
          action: portalUrl
            ? { label: people ? `Yes, still ${people} — confirm` : "Add everyone and confirm", url: portalUrl }
            : undefined,
          note: portalUrl ? undefined : `Sign in to your ${brand.studioName} client portal to confirm.`,
        };
      }
      const beauty = finalTrade.family === "beauty";
      const wedding = stringValue(values, "eventKind") === "wedding";
      const summary =
        finalTrade.family === "music"
          ? `Here's everything we have for your ${wedding ? "night" : "event"}${project}: the venue and times, and your ${finalWords.detailsForm ?? "planner"}.`
          : beauty
            ? `Here's everything we have for your morning${project}: where everyone is getting ready, the ready-by time, and your ${finalWords.detailsForm ?? "party list"}.`
            : wedding
              ? `Here's everything we have for your day${project}: where you're getting ready, the ceremony and reception, any photo stops, and the timeline.`
              : `Here's everything we have for your day${project}: every location and time, and the timeline.`;
      return {
        subject: `Please confirm your final details with ${brand.studioName}`,
        preheader: beauty ? "Everyone getting ready, and when, in one place." : "Every location and time for your day, in one place.",
        eyebrow: "Final details",
        heading: "Your final details are ready to confirm",
        paragraphs: [
          greeting,
          summary,
          beauty
            ? "Please check it and confirm. From here, people can be added but not taken off, and a change to the location or time comes to us to agree."
            : "Please check it and confirm. From here, small things you can still change yourself; a change to a location or time comes to us to agree.",
          ...(safeUrl(stringValue(values, "finalCallUrl"))
            ? [
                finalTrade.family === "photo"
                  ? "Let's also find a time for a short call to go over everything together and make any last changes to your timeline."
                  : `Let's also find a time for your ${finalWords.finalCall.toLowerCase()} to go over everything together.`,
              ]
            : []),
        ],
        action: portalUrl ? { label: "Check and confirm", url: portalUrl } : undefined,
        // The final details call (planning/final-details.ts finalCallLink).
        moreActions: safeUrl(stringValue(values, "finalCallUrl"))
          ? [{ label: `Book your ${finalWords.finalCall.toLowerCase()}`, url: safeUrl(stringValue(values, "finalCallUrl")) }]
          : undefined,
        note: portalUrl ? undefined : `Sign in to your ${brand.studioName} client portal to confirm them.`,
      };
    }
    case "billing_address_request":
      /**
       * QuickBooks works out the sales tax from the billing address, and this
       * couple never gave one (billing/billing-address-request.ts). The whole
       * point is the link: no portal URL, no button, and the copy still says
       * where to go.
       */
      return {
        subject: `Your billing address for ${brand.studioName}`,
        preheader: "One minute: the address we put on your invoice.",
        eyebrow: "Billing address",
        heading: "Could you confirm your billing address?",
        paragraphs: [
          greeting,
          `Before we send the final invoice${project}, we need the billing address to put on it — sales tax is worked out from it.`,
          "It takes a minute, and you only do it once.",
        ],
        action: portalUrl ? { label: "Add your billing address", url: portalUrl } : undefined,
        note: portalUrl ? undefined : `Sign in to your ${brand.studioName} client portal to add it.`,
      };
    case "album_selection_reminder": {
      /**
       * The reminder that exists to carry a link.
       *
       * This case was missing, so both reminders — day 7 and day 14 — fell to
       * the `default` below and went out as "There's an update from your
       * studio" with nothing to click, while the job recorded them as sent.
       * Same failure as the crew invitation in CLAUDE.md, in another lane.
       */
      const instructionsUrl = safeUrl(stringValue(values, "instructionsUrl"));
      const destination = instructionsUrl || portalUrl;
      return {
        subject: `Your album selections for ${brand.studioName}`,
        preheader: "Choose the photographs for your album.",
        eyebrow: "Album",
        heading: "Ready to choose your album photographs?",
        paragraphs: [
          greeting,
          `Whenever you're ready, pick the photographs you'd like in your album${project}. There's no rush — we'll hold your gallery until you are.`,
          ...(instructionsUrl
            ? ["The instructions below walk you through it."]
            : []),
        ],
        action: destination
          ? { label: instructionsUrl ? "Choose your photographs" : "Open your portal", url: destination }
          : undefined,
        secondaryAction:
          instructionsUrl && portalUrl
            ? { label: "Your project portal", url: portalUrl }
            : undefined,
      };
    }
    case "review_request":
      return {
        subject: `Would you share your experience with ${brand.studioName}?`,
        preheader: `A short review helps future clients choose their ${tradeVocab(values.trade).provider}.`,
        eyebrow: "Client feedback",
        heading: "Thank you for choosing us",
        paragraphs: [
          greeting,
          `We'd be grateful if you shared an honest review of your experience.`,
          "Opening the review link does not tell us that a review was posted. You can confirm completion separately in your portal.",
        ],
        action: destinationUrl
          ? { label: "Share your experience", url: destinationUrl }
          : undefined,
        // It named the portal and then did not link it.
        secondaryAction: portalUrl
          ? { label: "Your project portal", url: portalUrl }
          : undefined,
      };
    case "manual_message": {
      const subject =
        stringValue(values, "customSubject") ||
        `${brand.studioName} sent you an update`;
      const body =
        stringValue(values, "customBody") ||
        `${brand.studioName} has an update for you.`;
      const label = stringValue(values, "actionLabel") || "Open project portal";
      return {
        subject,
        preheader: body.slice(0, 120),
        eyebrow: "A note from your studio",
        heading: input.projectName
          ? `A note about ${input.projectName}`
          : `An update from ${brand.studioName}`,
        paragraphs: [greeting, ...clientEmailParagraphs(body)],
        action: actionUrl ? { label, url: actionUrl } : undefined,
      };
    }
    // The owner's own morning brief — a personal internal note, so it skips the
    // client-facing "note from your studio" shell. The heading greets by name;
    // the body carries the items, so it must NOT repeat the greeting.
    case "platform_demo_requested": {
      // To the team inbox. Reply-To is the photographer, so answering is one tap.
      const name = stringValue(values, "leadName") || "A photographer";
      const studio = stringValue(values, "leadStudioName");
      const lines = [
        stringValue(values, "leadMessage"),
        "",
        `From: ${name}${studio ? `, ${studio}` : ""}`,
        stringValue(values, "leadEmail") ? `Email: ${stringValue(values, "leadEmail")}` : "",
        stringValue(values, "leadPhone") ? `Phone: ${stringValue(values, "leadPhone")}` : "",
        stringValue(values, "leadWebsite") ? `Website or Instagram: ${stringValue(values, "leadWebsite")}` : "",
        stringValue(values, "leadPreferredTimes") ? `Good times: ${stringValue(values, "leadPreferredTimes")}` : "",
        stringValue(values, "leadHeard") ? `Heard about us: ${stringValue(values, "leadHeard")}` : "",
      ];
      return {
        subject: `[Demo request] ${name}${studio ? ` · ${studio}` : ""}`,
        preheader: `${name} asked for a demo of StudioCue.`,
        eyebrow: "Demo request",
        heading: `${name} would like a demo`,
        paragraphs: lines.flatMap((line) => line.split(/\r?\n/)).map((line) => line.trim()).filter(Boolean),
        action: actionUrl ? { label: "Open in Pipeline", url: actionUrl } : undefined,
        note: "Reply to this email to answer them directly.",
      };
    }
    case "feedback_received": {
      // To the team inbox. Everything needed to answer without opening
      // anything else; the screenshot rides as an attachment.
      const kindLabel = feedbackKindLabel(stringValue(values, "feedbackKind"));
      const studio = stringValue(values, "studioName") || "A studio";
      const senderName = stringValue(values, "senderName");
      const senderEmail = stringValue(values, "senderEmail");
      const role = stringValue(values, "senderRole").replace(/_/g, " ");
      const route = stringValue(values, "route");
      const device = [stringValue(values, "viewport"), stringValue(values, "userAgent")].filter(Boolean).join(" · ");
      const lastError = stringValue(values, "lastError");
      const message = stringValue(values, "feedbackMessage");
      return {
        subject: stringValue(values, "feedbackSubject") || `[Feedback · ${kindLabel}] ${studio}`,
        preheader: message.slice(0, 120) || `${kindLabel} from ${studio}.`,
        eyebrow: `Feedback · ${kindLabel}`,
        heading: `${kindLabel} from ${studio}`,
        paragraphs: [
          ...message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
          `From: ${[senderName, senderEmail ? `<${senderEmail}>` : "", role ? `(${role})` : ""].filter(Boolean).join(" ") || "unknown"}`,
          route ? `Screen: ${route}` : "",
          device ? `Device: ${device}` : "",
          lastError ? `Last error on screen: ${lastError}` : "",
          stringValue(values, "feedbackScreenshotPath") ? "Screenshot attached." : "No screenshot.",
        ].filter(Boolean),
        action: actionUrl ? { label: "Open in triage", url: actionUrl } : undefined,
        note:
          values.followUpOk === true
            ? "They're happy to hear back. Reply to this email to answer them directly."
            : "They asked not to be contacted about this one.",
      };
    }
    case "feedback_thanks": {
      const kind = stringValue(values, "feedbackKind");
      const message = stringValue(values, "feedbackMessage");
      const followUp = values.followUpOk === true;
      const whatNext =
        kind === "broken"
          ? followUp
            ? "We're looking into what went wrong. If we need more detail, we'll reply to this email."
            : "We're looking into what went wrong."
          : kind === "confusing"
            ? "If it confused you, it's confusing someone else too. Thank you for flagging it."
            : kind === "praise"
              ? "It means a lot to hear what's working. Thank you."
              : followUp
                ? "We'll let you know if it makes it onto the plan."
                : "Ideas like this are how we decide what to build next.";
      return {
        subject: "Thanks, we've got your feedback",
        preheader: "Every piece of feedback is read by the StudioCue team.",
        eyebrow: "Feedback received",
        heading: "Thank you for telling us",
        paragraphs: [
          greeting,
          "Every piece of feedback is read by the StudioCue team, and it shapes what we build next.",
          whatNext,
          ...(message ? [`What you sent: \u201c${clip(message, 600)}\u201d`] : []),
          "The StudioCue team",
        ],
        action: actionUrl ? { label: "See your feedback", url: actionUrl } : undefined,
        note: "You can reply to this email to add anything you forgot.",
      };
    }
    case "feedback_planned":
    case "feedback_shipped": {
      const shipped = input.key === "feedback_shipped";
      const broken = stringValue(values, "feedbackKind") === "broken";
      const message = stringValue(values, "feedbackMessage");
      const statusNote = stringValue(values, "statusNote");
      return {
        subject: shipped
          ? broken
            ? "Fixed: the problem you reported"
            : "You asked, and it's live in StudioCue"
          : broken
            ? "We're fixing the problem you reported"
            : "Your idea is on the StudioCue plan",
        preheader: shipped ? "Thank you for helping make StudioCue better." : "We'll write again when it's live.",
        eyebrow: shipped ? "Your feedback, shipped" : "Your feedback, planned",
        heading: shipped ? (broken ? "It's fixed" : "It's live") : "It's on the plan",
        paragraphs: [
          greeting,
          ...(message ? [`You told us: \u201c${clip(message, 400)}\u201d`] : []),
          shipped
            ? broken
              ? "That's now fixed in StudioCue."
              : "That's now live in StudioCue."
            : broken
              ? "We've found it and a fix is on the way."
              : "We've put it on the plan for StudioCue.",
          ...(statusNote ? [statusNote] : []),
          shipped
            ? "Thank you for taking the time to tell us. It made StudioCue better for every studio."
            : "We'll write again when it's live.",
          "The StudioCue team",
        ],
        action: actionUrl ? { label: "See your feedback", url: actionUrl } : undefined,
      };
    }
    case "platform_message": {
      // Written in the Console by the team, to a studio's owner. The body is
      // theirs, line for line; the frame and sign-off are ours, so a message
      // can never go out unsigned or signed by a person.
      const subject = stringValue(values, "customSubject") || "A note from the StudioCue team";
      const body = stringValue(values, "customBody");
      const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const label = stringValue(values, "actionLabel") || "Open StudioCue";
      return {
        subject,
        preheader: (lines[0] ?? "A note from the StudioCue team.").slice(0, 120),
        eyebrow: "From the StudioCue team",
        heading: subject,
        paragraphs: [greeting, ...(lines.length ? lines : ["We wanted to get in touch about your studio."]), "The StudioCue team"],
        action: actionUrl ? { label, url: actionUrl } : undefined,
        note: "Reply to this email and it reaches the StudioCue team.",
      };
    }
    case "feedback_reply": {
      // The team answering a piece of feedback from the Console inbox.
      const body = stringValue(values, "customBody");
      const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const original = stringValue(values, "feedbackMessage");
      return {
        subject: stringValue(values, "customSubject") || "Re: your feedback to StudioCue",
        preheader: (lines[0] ?? "The StudioCue team replied to your feedback.").slice(0, 120),
        eyebrow: "Reply to your feedback",
        heading: "The StudioCue team replied",
        paragraphs: [
          greeting,
          ...(lines.length ? lines : ["Thank you for your feedback."]),
          ...(original ? [`You wrote: “${clip(original, 400)}”`] : []),
          "The StudioCue team",
        ],
        action: actionUrl ? { label: "See your feedback", url: actionUrl } : undefined,
        note: "Reply to this email and it reaches the StudioCue team.",
      };
    }
    case "daily_digest": {
      const subject =
        stringValue(values, "customSubject") || `Your ${brand.studioName} brief`;
      const body =
        stringValue(values, "customBody") ||
        "Here's what needs your attention today.";
      const label = stringValue(values, "actionLabel") || "Review in StudioCue";
      return {
        subject,
        preheader: body.replace(/\s+/g, " ").trim().slice(0, 120),
        eyebrow: "Your morning brief",
        heading: recipient ? `Good morning, ${firstNameOf(recipient)}` : "Good morning",
        paragraphs: clientEmailParagraphs(body),
        action: actionUrl ? { label, url: actionUrl } : undefined,
      };
    }
    // Studio-facing, unlike almost everything else here. A client writing in
    // used to produce an in-app task and nothing else, so the studio only found
    // out by logging in and looking.
    case "autopay_charged":
      return {
        subject: `Your final balance is paid${project}`,
        preheader: "Your saved card was charged for the final balance.",
        eyebrow: "Payment received",
        heading: "Your final balance is paid",
        paragraphs: [
          greeting,
          `As you arranged, ${brand.studioName} charged ${stringValue(values, "cardText") || "your saved card"} ${stringValue(values, "amountText")} for your final balance${project}.`,
          "Nothing else is needed from you. Your receipt is in your client portal.",
        ],
        action: portalUrl ? { label: "Open your portal", url: portalUrl } : undefined,
      };
    case "autopay_charge_failed":
      return {
        subject: `Your card was declined for the final balance${project}`,
        preheader: "You can pay with the invoice link instead.",
        eyebrow: "Payment declined",
        heading: "We couldn't charge your saved card",
        paragraphs: [
          greeting,
          `Your saved card was declined for the final balance${project}.`,
          values.willRetry === true
            ? "We'll try it once more in 3 days. If you'd rather not wait, or want to use a different card, you can pay with the secure invoice link below."
            : "You can pay with the secure invoice link below, whenever you're ready.",
        ],
        action: invoiceUrl ? { label: "Pay the invoice", url: invoiceUrl } : undefined,
      };
    case "billing_trial_ending": {
      const studio = stringValue(values, "studioName") || "your studio";
      const when = stringValue(values, "trialEndText") || "soon";
      const plan = stringValue(values, "planName") || "Studio";
      const price = stringValue(values, "priceText");
      return {
        subject: `Your StudioCue trial ends ${when}`,
        preheader: `Your ${plan} plan starts then${price ? ` at ${price}` : ""}. Nothing to do if you're staying.`,
        eyebrow: "Your trial",
        heading: `Your trial ends ${when}`,
        paragraphs: [
          greeting,
          `The free trial for ${studio} ends on ${when}. Your ${plan} plan starts then, and the card you added is charged${price ? ` ${price}` : ""}. It renews automatically until you cancel.`,
          "If you're staying, there's nothing to do. To change plan or cancel before then, open Plan & billing.",
        ],
        action: actionUrl ? { label: "Plan & billing", url: actionUrl } : undefined,
      };
    }
    case "billing_payment_failed": {
      const studio = stringValue(values, "studioName") || "your studio";
      const amount = stringValue(values, "amountText");
      const until = stringValue(values, "graceEndText");
      return {
        subject: "Your StudioCue payment didn't go through",
        preheader: until ? `Update your card by ${until} to keep everything running.` : "Update your card to keep everything running.",
        eyebrow: "Payment failed",
        heading: "We couldn't take your payment",
        paragraphs: [
          greeting,
          `Your card was declined${amount ? ` for ${amount}` : ""} for ${possessive(studio)} StudioCue subscription.`,
          until
            ? `Everything keeps working until ${until}. After that the studio becomes read-only: you can still open every job and export your data, but nothing can be sent or changed, and messages to your clients are held until payment goes through.`
            : "Update your card to keep everything running.",
          "Update your card and the payment is tried again right away.",
        ],
        action: actionUrl ? { label: "Update your card", url: actionUrl } : undefined,
      };
    }
    case "billing_referral_credit": {
      const amount = stringValue(values, "amountText");
      return {
        subject: `You've earned ${amount || "a"} StudioCue credit`,
        preheader: "It comes off your next bill automatically.",
        eyebrow: "Referral credit",
        heading: `${amount || "Your credit"} is on your account`,
        paragraphs: [
          greeting,
          `Thanks for spreading the word. A studio you referred has now been with StudioCue for three months, so we've added a one-off ${amount || "credit"} to your account.`,
          "It comes off your next bill automatically. Nothing to do.",
        ],
        action: actionUrl ? { label: "See your referrals", url: actionUrl } : undefined,
      };
    }
    case "platform_vendor_invite": {
      const studio = stringValue(values, "studioName") || "A studio you work with";
      const code = stringValue(values, "code");
      const unsubscribeUrl = stringValue(values, "unsubscribeUrl");
      return {
        subject: `${studio} invited you to try StudioCue`,
        preheader: "14 days free, then half price for your first year.",
        eyebrow: "An invitation",
        heading: `${studio} thinks you'd like StudioCue`,
        paragraphs: [
          greeting,
          `${studio} runs their bookings on StudioCue, and you're on one of their upcoming events. They'd like you to try it too.`,
          "StudioCue looks after the office side: inquiries, proposals, contracts, payments, forms and the day's timeline, with an assistant that drafts the next step for you to approve.",
          `With ${possessive(studio)} code you get 14 days free, then $75/month billed yearly for your first year, half the usual $150. Or $100/month if you'd rather pay monthly.`,
        ],
        details: code ? [{ label: "Your code", value: code }] : undefined,
        action: actionUrl ? { label: "Start your free trial", url: actionUrl } : undefined,
        note: `You're getting this once because ${studio} added you to a job on StudioCue. We won't email you about it again.`,
        secondaryAction: unsubscribeUrl ? { label: "Don't email me about StudioCue", url: unsubscribeUrl } : undefined,
      };
    }
    case "billing_payment_recovered": {
      const studio = stringValue(values, "studioName") || "your studio";
      const amount = stringValue(values, "amountText");
      return {
        subject: "Your StudioCue payment went through",
        preheader: "Everything is back to normal.",
        eyebrow: "Payment received",
        heading: "You're all set",
        paragraphs: [
          greeting,
          `Thank you — ${amount ? `${amount} was paid` : "your payment went through"} for ${possessive(studio)} StudioCue subscription, and everything is back to normal.`,
          "Any messages to your clients that were held while the payment was outstanding are on their way.",
        ],
        action: actionUrl ? { label: "Open StudioCue", url: actionUrl.replace(/\/studio\/subscription$/, "/studio") } : undefined,
      };
    }
    // "Cue's first two weeks" (saas/trial-series.ts). To the studio owner, so
    // these may name Cue; signed by the team, never by a person.
    case "trial_cue_starts": {
      const studio = stringValue(values, "studioName") || "your studio";
      return {
        subject: "Cue starts today",
        preheader: "What it does on its own, what it leaves for you, and three things to set up first.",
        eyebrow: "Your first two weeks",
        heading: "Cue starts today",
        paragraphs: [
          greeting,
          `Cue is the office manager in ${possessive(studio)} StudioCue. Some of the work it does on its own, at any hour: it acknowledges every inquiry from your form and checks the date, reminds clients to sign, books the job when the retainer is paid, and sends crew their call times.`,
          "The rest it prepares and leaves on Today for you: your first reply to an inquiry, follow-ups, payment reminders and crew offers. Payments, signatures and anything Cue wrote in its own words always wait for your tap.",
          "Three things make it useful in the first week:",
          [
            "- Send it your inquiries: your website form, inbox forwarding or your inquiry link (Settings, Inquiry capture).",
            "- Connect QuickBooks, so retainers and final balances go out from your own books (Integrations).",
            "- Bring in the jobs you've already booked. Their clients aren't emailed (Jobs, Import bookings).",
          ].join("\n"),
          "Setup walks through each one and shows what's done. Most take a few minutes.",
          "The StudioCue team",
        ],
        action: actionUrl ? { label: "Open setup", url: actionUrl } : undefined,
      };
    }
    case "trial_cue_so_far": {
      const studio = stringValue(values, "studioName") || "your studio";
      const activity = trialActivityFrom(recordValue(values, "trialActivity"));
      const days = numberValue(values, "trialDays");
      const since = days && days > 1 ? `in your first ${days} days` : "since your trial started";
      // Nothing happened: say so, and say what gives Cue work. Never a list of zeros.
      if (!activity || (activity.inquiries === 0 && activity.emailsSent === 0 && activity.drafted === 0)) {
        return {
          subject: "Cue hasn't had anything to do yet",
          preheader: "Nothing has reached it so far. Here's how to give it work.",
          eyebrow: "Your first two weeks",
          heading: "Nothing to report yet",
          paragraphs: [
            greeting,
            `Nothing has reached Cue at ${studio} ${since}: no inquiries, nothing to send, nothing to prepare. That's normal until your inquiries point at it. The quickest ways to give it work:`,
            [
              "- Send it your inquiries: your website form, inbox forwarding or your inquiry link.",
              "- Fill out your own inquiry form once, and see what a new client gets back.",
              "- Bring in the jobs you've already booked, so their reminders run here. Their clients aren't emailed.",
            ].join("\n"),
            "The StudioCue team",
          ],
          action: actionUrl ? { label: "Set up inquiries", url: actionUrl } : undefined,
        };
      }
      const lines = trialActivityLines(activity);
      return {
        subject: "What Cue did so far",
        preheader: (lines[0] ?? "").replace(/^- /, "") || "Here's what Cue did for you so far.",
        eyebrow: "Your first two weeks",
        heading: "What Cue did so far",
        paragraphs: [
          greeting,
          `Here's what Cue did for ${studio} ${since}:`,
          lines.join("\n"),
          activity.waiting > 0
            ? `${activity.waiting === 1 ? "One thing is" : `${activity.waiting} things are`} waiting on you in Today.`
            : "Nothing is waiting on you right now.",
          ...(activity.inquiries === 0
            ? ["No inquiries have reached it yet. Once your form or inbox forwarding points at Cue, it starts on each one the minute it arrives."]
            : []),
          "The StudioCue team",
        ],
        action: actionUrl ? { label: "Open Today", url: actionUrl } : undefined,
      };
    }
    case "trial_cue_without_asking": {
      const approvals = numberValue(values, "trustApprovals") ?? 3;
      const count = COUNT_WORDS[approvals] ?? String(approvals);
      // Only the routine messages this studio's trade has (trades.ts): a
      // makeup artist or hair stylist has no consultation and no day-before
      // checklist, and a DJ's call is a vibe call.
      const trade = tradeProfile(values.trade);
      const routine = [
        "the schedule confirmation",
        "the final balance summary",
        ...(trade.clientDayBefore ? ["the day-before checklist"] : []),
        ...(trade.consultation ? [`the note ahead of a ${tradeVocab(values.trade).consultation.toLowerCase()}`] : []),
      ];
      const routineList = `${routine.slice(0, -1).join(", ")} and ${routine.at(-1)}`;
      return {
        subject: "What Cue can do without asking",
        preheader: `Approve the same routine message ${count} times unchanged, and Cue offers to stop asking.`,
        eyebrow: "Your first two weeks",
        heading: "Want Cue to stop asking?",
        paragraphs: [
          greeting,
          `Cue starts out asking. Its routine messages (${routineList}) each wait for your tap.`,
          `Approve the same kind ${count} times in a row without changing a word, and Cue offers to send that one on its own from then on. Say no and it keeps asking. Say yes and you can turn it back off any time.`,
          "Some things always wait for you, whatever you choose: payments, anything that needs a signature, and any message Cue wrote in its own words.",
          "Every setting is in one place, under What Cue can do without asking.",
          "The StudioCue team",
        ],
        action: actionUrl ? { label: "What Cue can do without asking", url: actionUrl } : undefined,
      };
    }
    case "participant_receipt": {
      const athlete = stringValue(values, "athleteName");
      const item = stringValue(values, "packageName");
      const method = stringValue(values, "methodText");
      const amount = stringValue(values, "amountText") || "your payment";
      return {
        subject: `Your receipt from ${brand.studioName}`,
        preheader: `${amount} received${athlete ? ` for ${athlete}` : ""}. Thank you.`,
        eyebrow: "Receipt",
        heading: "Payment received",
        paragraphs: [
          greeting,
          // "for Sam's photos" only from a photographer: a vendor's roster is
          // paid for the athlete, not for photos (trades.ts).
          `Thank you. ${brand.studioName} received ${amount}${method ? ` ${method}` : ""}${athlete ? ` for ${athlete}${photoWord(values, "'s photos")}` : ""}${item ? ` (${item})` : ""}${project}.`,
          "Keep this email as your receipt. If anything looks wrong, reply and the studio will put it right.",
        ],
      };
    }
    case "studio_booking_confirmed":
      return {
        subject: `You're booked${project}`,
        preheader: "The agreement is signed and the retainer is paid.",
        eyebrow: "New booking",
        heading: "The date is yours",
        paragraphs: [
          `The agreement is signed and the retainer is paid${project}, so StudioCue confirmed the booking.`,
          "The client portal, planning checklist, calendar entry and job folder are being set up now. Nothing else is needed from you.",
        ],
        action: actionUrl ? { label: "Open the job", url: actionUrl } : undefined,
      };
    case "studio_capture_silent": {
      const days = Number(values.silentDays) || 7;
      return {
        subject: `No inquiries have reached StudioCue in ${days} days`,
        preheader: "Check your inbox forwarding is still working.",
        eyebrow: "Inquiry capture",
        heading: "Your inquiries have gone quiet",
        paragraphs: [
          `StudioCue hasn't captured an inquiry from your inbox in ${days} days, which is longer than usual for ${brand.studioName}.`,
          "It may just be a quiet week. But if your email forwarding stopped (a changed password, a deleted filter, or a mailbox move can do it), inquiries will be waiting in your inbox instead.",
          "The quickest check: fill out your own website form and see whether it appears in StudioCue within a couple of minutes.",
        ],
        action: actionUrl ? { label: "Check inquiry capture", url: actionUrl } : undefined,
      };
    }
    case "studio_new_inquiry": {
      const wedding = stringValue(values, "eventKind") === "wedding";
      const couple = stringValue(values, "coupleName") || (wedding ? "A new couple" : "A new client");
      const when = stringValue(values, "eventDateLabel");
      const availability = stringValue(values, "availability");
      const source = stringValue(values, "sourceLabel");
      const firstName = stringValue(values, "coupleFirstName");
      // The worker set Reply-To to the couple (operations/jobs.ts), so a
      // reply from the studio's own inbox reaches them, not StudioCue.
      const replyable = values.replyToCouple === true;
      // A couple with a job already open, writing through the form again.
      const returning = values.returning === true;
      const message = stringValue(values, "message");
      const details = Array.isArray(values.details)
        ? values.details.flatMap((row) => {
            const entry = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
            const label = typeof entry.label === "string" ? entry.label.trim() : "";
            const value = typeof entry.value === "string" ? entry.value.trim() : "";
            return label && value ? [{ label, value }] : [];
          })
        : [];
      return {
        subject: `${returning ? "New message" : "New inquiry"}: ${couple}${when ? `, ${when}` : ""}`,
        preheader: message
          ? clip(message, 90)
          : availability === "available"
            ? "The date is free and a reply is being prepared."
            : availability === "conflict"
              ? "You already have a job on that date."
              : "A reply is being prepared.",
        eyebrow: returning ? "New message" : "New inquiry",
        // A makeup or hair inquiry has no call (trades.ts): they want the quote.
        heading: returning
          ? `${couple} wrote again`
          : tradeProfile(values.trade).consultation
            ? `${couple} would like to talk`
            : `${couple} would like a ${tradeVocab(values.trade).proposal.toLowerCase()}`,
        paragraphs: [
          [
            when ? `They're asking about ${when}` : "They didn't give a date yet",
            source ? ` (${source})` : "",
            ".",
          ].join(""),
          returning
            ? "They already have a job with you, so StudioCue added this to it and is drafting a reply for Today."
            : availability === "available"
              ? "The date is free. StudioCue is drafting a reply now — it'll be on Today for you to check and send."
              : availability === "conflict"
                ? "You already have a job on that date. StudioCue is drafting a reply for you to check — you can close it as date taken once you've answered."
                : "StudioCue is drafting a reply now — it'll be on Today for you to check and send.",
          ...(replyable
            ? [
                `Rather answer from your own inbox? Just hit reply — it goes straight to ${firstName || "them"}. Then tap “Replied by email” on Today, so the drafted reply isn't sent as well.`,
              ]
            : [
                `${wedding ? "Couples" : "People"} often write to several ${tradeVocab(values.trade).provider}s at once; the first thoughtful reply tends to win.`,
              ]),
        ],
        details,
        quote: message ? { label: returning ? "Their message" : "What they wrote", text: message } : undefined,
        action: actionUrl ? { label: returning ? "Open the job" : "Open the inquiry", url: actionUrl } : undefined,
      };
    }
    case "studio_schedule_changes_requested": {
      const couple =
        stringValue(values, "coupleName") || (stringValue(values, "eventKind") === "wedding" ? "Your couple" : "Your client");
      const version = Number(values.scheduleVersion) || null;
      const note = stringValue(values, "changeNote");
      return {
        subject: `${couple} asked for changes to the day plan`,
        preheader: note ? clip(note, 90) : "They looked through the timeline and want something changed.",
        eyebrow: "Day plan",
        heading: `${couple} asked for changes`,
        paragraphs: [
          `${couple} looked through ${version ? `version ${version} of ` : ""}the day plan in their portal and asked for a change.`,
          ...(note ? [`They wrote: “${note}”`] : []),
          "Open the plan, make the change, and publish it again. They'll be asked to check the new version, and your crew will see it too.",
        ],
        action: actionUrl ? { label: "Open the day plan", url: actionUrl } : undefined,
      };
    }
    case "client_message_received": {
      const senderName = stringValue(values, "senderName") || "A client";
      const messageSubject = stringValue(values, "messageSubject");
      const messagePreview = stringValue(values, "messagePreview");
      const preparedReply = stringValue(values, "preparedReplyBody");
      const approveUrl = safeUrl(stringValue(values, "approveUrl"));
      const basedOn = Array.isArray(values.preparedReplyBasedOn)
        ? (values.preparedReplyBasedOn as unknown[]).map(String).filter(Boolean)
        : [];

      // When StudioCue already holds the answer, the answer belongs in this
      // email. Making the studio open the app to read a reply the system had
      // composed from its own records is the step worth removing.
      if (preparedReply && approveUrl) {
        return {
          subject: `${senderName} asked: ${messageSubject || "a question"}`,
          preheader: "A reply is ready — read it and send in one tap.",
          eyebrow: "Client message",
          heading: `${senderName} asked a question`,
          paragraphs: [
            greeting,
            ...(messagePreview ? [`They wrote: “${messagePreview}”`] : []),
            "StudioCue has a reply ready from your project records:",
            preparedReply,
            ...(basedOn.length ? [`Based on: ${basedOn.join("; ")}`] : []),
          ],
          action: { label: "Review and send this reply", url: approveUrl },
          note: "Nothing is sent until you confirm on that page.",
        };
      }

      return {
        subject: `${senderName} sent you a message${project}`,
        preheader:
          messageSubject || "A new client message is waiting in StudioCue.",
        eyebrow: "Client message",
        heading: `${senderName} sent you a message`,
        paragraphs: [
          greeting,
          `${senderName} wrote to you${project}.`,
          ...(messageSubject ? [`Subject: ${messageSubject}`] : []),
          ...(messagePreview ? [`“${messagePreview}”`] : []),
        ],
        action: actionUrl
          ? { label: "Open the message", url: actionUrl }
          : undefined,
        note: "Reply in StudioCue so the exchange stays on the project record.",
      };
    }
    default:
      return {
        subject: `${brand.studioName} sent you an update`,
        preheader: `A ${photoWord(values)}project update is available.`,
        eyebrow: "Project update",
        heading: "There’s an update from your studio",
        paragraphs: [
          greeting,
          `${brand.studioName} has an update for you in StudioCue.`,
        ],
        action: actionUrl
          ? { label: "View update", url: actionUrl }
          : undefined,
      };
  }
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const normalizeColor = (value: string): string =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : "#35664a";

/**
 * How a person is addressed: "Hi John," not "Hi John Smith,".
 *
 * The contact record holds a full name because that is what a contact record
 * is for, and the greeting used it verbatim — every client email opened by
 * addressing the couple the way a form letter does.
 *
 * An honorific on its own is worse than the full name ("Hi Dr.,"), so skip it
 * and take the name after it.
 */
const honorific = /^(?:mr|mrs|ms|miss|mx|dr|prof|rev|sir|dame)\.?$/i;

const FEEDBACK_KIND_LABELS: Record<string, string> = {
  idea: "Idea",
  broken: "Something's broken",
  confusing: "Confusing",
  praise: "Love this",
};

function feedbackKindLabel(kind: string): string {
  return FEEDBACK_KIND_LABELS[kind] ?? "Feedback";
}

function clip(value: string, length: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}\u2026` : flat;
}

/** "First", "Second", … for a follow-up's number; "Follow-up 6" past the words. */
export function followUpOrdinal(n: number): string {
  const words = ["First", "Second", "Third", "Fourth", "Fifth"];
  return words[n - 1] ? `${words[n - 1]} follow-up` : `Follow-up ${n}`;
}

export function firstNameOf(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [first, second] = parts;
  if (!first) return value.trim();
  if (second && honorific.test(first)) return second;
  return first;
}

const listItemsHtml = (lines: string[]): string =>
  lines
    .map(
      (line) =>
        `<li style="margin:0 0 8px;">${escapeHtml(line.replace(bulletLinePattern, ""))}</li>`,
    )
    .join("");

/**
 * A paragraph, or a list when that is what was written.
 *
 * Everything here used to become a `<p>`, so a block of bullet lines rendered
 * as one wall of text with stray hyphens in it.
 */
const paragraphHtml = (paragraph: string): string => {
  const lines = paragraph
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 1 && lines.every((line) => bulletLinePattern.test(line))) {
    const ordered = lines.every((line) => /^\s*\d+[.)]\s+/.test(line));
    const tag = ordered ? "ol" : "ul";
    return `<${tag} class="email-list" style="margin:0 0 18px;padding-left:22px;color:#4f5752;font-size:16px;line-height:1.7;">${listItemsHtml(lines)}</${tag}>`;
  }
  return `<p class="email-paragraph" style="margin:0 0 18px;color:#4f5752;font-size:16px;line-height:1.7;">${escapeHtml(paragraph)}</p>`;
};

/** Mail a couple (or another client) reads. */
export const CLIENT_EMAIL_TYPES: ReadonlySet<string> = new Set([
  "client_invitation", "inquiry_acknowledgement", "consultation_confirmation", "consultation_invitation",
  "consultation_reminder", "consultation_rescheduled", "consultation_cancelled", "package_follow_up",
  "proposal_sent", "contract_sent", "contract_ready", "contract_reminder", "contract_signed", "contract_voided",
  "contract_superseded", "amendment_withdrawn", "retainer_invoice", "final_invoice", "final_payment_reminder",
  "booking_confirmation", "questionnaire_request", "questionnaire_reminder", "project_cancelled",
  "billing_address_request", "final_details_request", "schedule_review", "final_schedule_published",
  "event_reminder", "thank_you", "delivery", "delivery_correction", "album_selection_reminder",
  "delivery_expiry_reminder", "review_request", "manual_message", "client_message_received", "autopay_charged",
  "autopay_charge_failed", "participant_receipt",
]);

/** Mail a crew member reads. */
export const CREW_EMAIL_TYPES: ReadonlySet<string> = new Set([
  "crew_invitation", "crew_directory_invitation", "crew_reminder", "crew_monthly_roundup", "crew_assignment_cancelled",
]);

/**
 * Every client and crew email can open StudioCue.
 *
 * Conor, 2026-10-06: "make sure all of them have a link to open Studiocue. I
 * received one … that didn't have it." Each template's button was optional,
 * shown only when the sender passed its URL, so any sender that forgot — or a
 * template that never had one (an inquiry acknowledgement before a job
 * existed, a voided agreement, a cancelled booking, a crew cancellation) —
 * sent mail with nowhere to go. When nothing else links, clients get their
 * home (the portal, or their inquiry page before they have an account — see
 * emailContext in operations/jobs.ts) and crew get their workspace.
 */
export function withStudioCueLink(copy: EmailCopy, input: RenderEmailInput): EmailCopy {
  const linked =
    Boolean(copy.action?.url) ||
    Boolean(copy.secondaryAction?.url) ||
    (copy.moreActions ?? []).some((extra) => Boolean(extra.url));
  if (linked) return copy;
  const appUrl = safeUrl(stringValue(input.values, "appUrl"));
  if (CREW_EMAIL_TYPES.has(input.key)) {
    return appUrl ? { ...copy, action: { label: "Open StudioCue", url: `${appUrl.replace(/\/$/, "")}/crew` } } : copy;
  }
  if (CLIENT_EMAIL_TYPES.has(input.key)) {
    const home = safeUrl(stringValue(input.values, "portalUrl"));
    return home
      ? { ...copy, action: { label: /\/i\//.test(home) ? "Open your inquiry" : "Open your client portal", url: home } }
      : copy;
  }
  return copy;
}

export function renderEmailTemplate(input: RenderEmailInput): RenderedEmail {
  const copy = withStudioCueLink(customizedCopy(copyFor(input), input), input);
  const accent = normalizeColor(input.brand.accentColor);
  const studioName = escapeHtml(input.brand.studioName);
  const productName = escapeHtml(input.brand.productName);
  // Platform mail (auth) sets studioName === productName. "StudioCue · Powered
  // by StudioCue" / "Sent by StudioCue using StudioCue" reads as a bug, so the
  // secondary "powered by / using" line is dropped when they are the same. For
  // tenant mail (studio ≠ product) it stays, correctly crediting the studio.
  const isPlatformSender = input.brand.studioName === input.brand.productName;
  const senderSubline = isPlatformSender
    ? ""
    : `<span style="display:block;color:#778079;font-size:12px;line-height:1.4;">Client operations powered by ${productName}</span>`;
  const sentByLine = isPlatformSender
    ? `Sent by ${studioName}.`
    : `Sent by ${studioName} using ${productName}.`;
  const logoUrl = input.brand.logoUrl
    ? safeUrl(input.brand.logoUrl)
    : "";
  const action = copy.action?.url
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0 26px;"><tr><td style="border-radius:10px;background:${accent};"><a href="${escapeHtml(copy.action.url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;">${escapeHtml(copy.action.label)}</a></td></tr></table>`
    : "";
  const moreActions = (copy.moreActions ?? [])
    .filter((extra) => extra.url)
    .map(
      (extra) =>
        `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:-12px 0 26px;"><tr><td style="border-radius:10px;background:${accent};"><a href="${escapeHtml(extra.url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;line-height:1.2;">${escapeHtml(extra.label)}</a></td></tr></table>`,
    )
    .join("");
  const secondaryAction = copy.secondaryAction?.url
    ? `<p style="margin:-14px 0 26px;font-size:14px;line-height:1.6;color:#626a65;"><a href="${escapeHtml(copy.secondaryAction.url)}" style="color:#4f5752;">${escapeHtml(copy.secondaryAction.label)}</a></p>`
    : "";
  const details = (copy.details ?? []).filter((row) => row.label && row.value);
  const detailsHtml = details.length
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;margin:6px 0 18px;border-collapse:collapse;">${details
        .map(
          (row) =>
            `<tr><td width="36%" style="width:36%;padding:8px 12px 8px 0;border-top:1px solid #e6eae7;color:#778079;font-size:13px;line-height:1.5;vertical-align:top;">${escapeHtml(row.label)}</td><td style="padding:8px 0;border-top:1px solid #e6eae7;color:#171a18;font-size:15px;line-height:1.5;vertical-align:top;word-break:break-word;">${escapeHtml(row.value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const quoteHtml = copy.quote?.text
    ? `<p style="margin:18px 0 6px;color:#778079;font-size:13px;line-height:1.5;">${escapeHtml(copy.quote.label)}</p><div style="margin:0 0 18px;padding:14px 18px;border-left:3px solid ${accent};background:#f5f7f5;color:#171a18;font-size:15px;line-height:1.65;white-space:pre-line;">${escapeHtml(copy.quote.text)}</div>`
    : "";
  const detailLines = [
    ...(details.length ? ["", ...details.map((row) => `${row.label}: ${row.value}`)] : []),
    ...(copy.quote?.text ? ["", `${copy.quote.label}:`, copy.quote.text] : []),
  ];
  const note = copy.note
    ? `<div style="margin-top:28px;padding:16px 18px;border:1px solid #dde3de;border-radius:12px;background:#f5f7f5;color:#626a65;font-size:13px;line-height:1.6;">${escapeHtml(copy.note)}</div>`
    : "";
  const brandMark = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="44" height="44" alt="${studioName}" style="display:block;width:44px;height:44px;border-radius:10px;object-fit:contain;">`
    : `<div style="width:44px;height:44px;border-radius:10px;background:#151916;color:#ffffff;font-size:19px;font-weight:800;line-height:44px;text-align:center;">${escapeHtml(input.brand.studioName.charAt(0).toUpperCase())}</div>`;
  // A postal address on every email (CAN-SPAM): the studio's own when it
  // has set one, otherwise StudioCue's operator (launch plan §1.6).
  const footerAddress =
    !isPlatformSender && input.brand.postalAddress?.trim()
      ? input.brand.postalAddress.trim()
      : OPERATOR_FOOTER;
  const contact = input.brand.contactEmail
    ? ` Questions? Reply to this email or contact <a href="mailto:${escapeHtml(input.brand.contactEmail)}" style="color:#4f5752;">${escapeHtml(input.brand.contactEmail)}</a>.`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.subject)}</title>
  <style>
    @media screen and (max-width:600px) {
      .email-shell { padding:20px 10px !important; }
      .email-brand { padding-bottom:16px !important; }
      .email-content { padding:28px 22px 24px !important; }
      .email-heading { font-size:25px !important; line-height:1.22 !important; margin-bottom:20px !important; }
      .email-paragraph { font-size:16px !important; line-height:1.58 !important; }
      .email-footer { padding-left:8px !important; padding-right:8px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#eef1ee;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171a18;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(copy.preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#eef1ee;">
    <tr><td class="email-shell" align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;">
        <tr><td class="email-brand" style="padding:0 4px 20px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="vertical-align:middle;">${brandMark}</td>
            <td style="padding-left:12px;vertical-align:middle;">
              <strong style="display:block;color:#171a18;font-size:17px;line-height:1.3;">${studioName}</strong>
              ${senderSubline}
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="overflow:hidden;border:1px solid #dde2de;border-radius:18px;background:#ffffff;box-shadow:0 14px 38px rgba(23,26,24,0.08);">
          <div style="height:6px;background:${accent};"></div>
          <div class="email-content" style="padding:42px 44px 38px;">
            <p style="margin:0 0 13px;color:${accent};font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(copy.eyebrow)}</p>
            <h1 class="email-heading" style="margin:0 0 24px;color:#171a18;font-size:31px;line-height:1.18;letter-spacing:-0.025em;">${escapeHtml(copy.heading)}</h1>
            ${copy.paragraphs.map(paragraphHtml).join("")}
            ${detailsHtml}
            ${quoteHtml}
            ${action}
            ${moreActions}
            ${secondaryAction}
            ${note}
          </div>
        </td></tr>
        <tr><td class="email-footer" style="padding:20px 18px 0;color:#7b837d;font-size:12px;line-height:1.65;text-align:center;">
          ${sentByLine}${contact}<br>
          This message relates to a private studio workspace or ${photoWord(input.values)}project.<br>
          ${escapeHtml(footerAddress)}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    isPlatformSender
      ? input.brand.studioName
      : `${input.brand.studioName} · Powered by ${input.brand.productName}`,
    "",
    copy.heading,
    "",
    ...copy.paragraphs,
    ...detailLines,
    ...(copy.action ? ["", `${copy.action.label}: ${copy.action.url}`] : []),
    ...(copy.moreActions ?? []).flatMap((extra) => ["", `${extra.label}: ${extra.url}`]),
    ...(copy.secondaryAction
      ? ["", `${copy.secondaryAction.label}: ${copy.secondaryAction.url}`]
      : []),
    ...(copy.note ? ["", copy.note] : []),
    "",
    isPlatformSender
      ? `Sent by ${input.brand.studioName}.`
      : `Sent by ${input.brand.studioName} using ${input.brand.productName}.`,
    footerAddress,
  ].join("\n");

  // What the studio actually said, without the branded wrapper. `text` is the
  // email as sent and stays the record of that; this is the same content for
  // places that are not an inbox — a thread bubble reading "FlawlessIQ · Powered
  // by StudioCue" above every message, and "Sent by FlawlessIQ using StudioCue"
  // below it, is repeating the letterhead inside the letter.
  const body = [
    copy.heading,
    "",
    ...copy.paragraphs,
    ...detailLines,
    ...(copy.action ? ["", `${copy.action.label}: ${copy.action.url}`] : []),
    ...(copy.moreActions ?? []).flatMap((extra) => ["", `${extra.label}: ${extra.url}`]),
    ...(copy.secondaryAction
      ? ["", `${copy.secondaryAction.label}: ${copy.secondaryAction.url}`]
      : []),
    ...(copy.note ? ["", copy.note] : []),
  ]
    .join("\n")
    .trim();

  return {
    subject: copy.subject,
    preheader: copy.preheader,
    html,
    text,
    body,
  };
}
