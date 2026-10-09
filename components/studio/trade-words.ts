import { BUSY_TIME_CALENDARS_COPY } from "@/features/integrations/schema";
import { DEFAULT_TRADE, tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * What a studio's booked calls are called, on the screens that list them or
 * set them up: the calendar, availability, integrations and search.
 *
 * One scheduling link books every call a studio has (features/consultations/
 * purpose.ts): a photographer's consultation, a DJ's vibe call,
 * a makeup artist's or hair stylist's trial, and the final details call. A
 * makeup or hair studio has no sales call at all (tradeProfile `consultation`),
 * so it is never told about one; the words name what it does book instead.
 */
export type CallWords = {
  /** The sales call before the offer ("Consultation", "Vibe call"), or null when the trade has none. */
  sales: string | null;
  /** Everything booked through the link, mid-sentence: "consultations", "vibe calls", "trials and calls". */
  booked: string;
  /** The same, as a label: "Consultations", "Vibe calls", "Trials and calls". */
  bookedLabel: string;
  /** The availability setting's name: "Consultation availability", "Booking availability". */
  availabilityTitle: string;
  /** Its one-line summary: "When clients can book a call". */
  availabilitySubtitle: string;
  /** The search shortcut to the calendar: "Schedule consultation". */
  scheduleAction: string;
  /** One booking, mid-sentence ("clients can book a {one}"): "consultation", "vibe call", "trial or call". */
  one: string;
  /** The slot length field: "Consultation length (minutes)". */
  lengthLabel: string;
};

export function callWords(trade: unknown): CallWords {
  const vocab = tradeVocab(trade);
  const profile = tradeProfile(trade);
  if (profile.consultation) {
    const plural = `${vocab.consultation}s`;
    return {
      sales: vocab.consultation,
      booked: plural.toLowerCase(),
      bookedLabel: plural,
      availabilityTitle: `${vocab.consultation} availability`,
      availabilitySubtitle: "When clients can book a call",
      scheduleAction: `Schedule ${vocab.consultation.toLowerCase()}`,
      one: vocab.consultation.toLowerCase(),
      lengthLabel: `${vocab.consultation} length (minutes)`,
    };
  }
  const trial = profile.trial;
  return {
    sales: null,
    booked: trial ? "trials and calls" : "calls",
    bookedLabel: trial ? "Trials and calls" : "Calls",
    availabilityTitle: "Booking availability",
    availabilitySubtitle: trial ? "When clients can book a trial or a call" : "When clients can book a call",
    scheduleAction: trial ? "Schedule a trial or call" : "Schedule a call",
    one: trial ? "trial or call" : "call",
    lengthLabel: "Booking length (minutes)",
  };
}

/** The busy-times note (features/integrations/schema.ts), naming what this trade's clients book. */
export function busyTimesLine(trade: unknown): string {
  const one = callWords(trade).one;
  if (one === "consultation") return BUSY_TIME_CALENDARS_COPY;
  return `We check Google Calendar, Outlook and Apple Calendar when connected, so clients can’t book a ${one} over something already in your calendar.`;
}

/** "Start a new photography job" — the kind of job the studio takes on. */
export function newJobLine(trade: unknown): string {
  return `Start a new ${tradeVocab(trade).service} job`;
}

/**
 * A role code as the studio reads it. The workspace calls the crew role
 * `staff_photographer` whatever the trade (features/auth/roles.ts); a DJ
 * business reads "Staff DJ", and a role named for a camera it doesn't use is
 * not offered to it at all (see `assignableRolesFor`).
 */
export function roleLabelFor(role: string | null | undefined, trade: unknown, fallback: (role: string | null) => string): string {
  if (role === "staff_photographer" && tradeProfile(trade).family !== "photo") return `Staff ${tradeVocab(trade).member}`;
  return fallback(role ?? null);
}

/** What a role can do, in one line: a DJ's crew "Sees the jobs they play". */
export function roleSummaryFor(role: string, trade: unknown, summaries: Readonly<Record<string, string>>): string {
  const summary = summaries[role] ?? "";
  // ROLE_SUMMARY is written in a photographer's verb; swap in this trade's.
  const said = `the jobs they ${tradeVocab(DEFAULT_TRADE).verb}`;
  return role === "staff_photographer" ? summary.replace(said, `the jobs they ${tradeVocab(trade).verb}`) : summary;
}

/** The roles an owner can give, without the videographer seat for a trade with no video. */
export function assignableRolesFor<R extends string>(roles: readonly R[], trade: unknown, current?: string): R[] {
  if (tradeProfile(trade).family === "photo") return [...roles];
  return roles.filter((role) => role !== "staff_videographer" || role === current);
}

/**
 * The Inquiries list's stage, in the trade's words: a DJ's "Vibe call", a
 * makeup artist's "Quote". `label` is the stage's own (features/inquiries/
 * stages.ts), returned as it is for every other stage.
 */
export function inquiryStageWord(stage: string, label: string, trade: unknown): string {
  const vocab = tradeVocab(trade);
  if (stage === "consult") return vocab.consultation === "Consultation" ? label : vocab.consultation;
  if (stage === "proposal") return vocab.proposal;
  return label;
}

/** The Inquiries tabs for this trade: no call tab for a trade that never has one. */
export function inquiryViewsFor<V extends string>(
  views: ReadonlyArray<readonly [V, string]>,
  trade: unknown,
): Array<readonly [V, string]> {
  const calls = tradeProfile(trade).consultation;
  return views
    .filter(([value]) => calls || value !== "consult")
    .map(([value, label]) => [value, inquiryStageWord(value, label, trade)] as const);
}
