import { jobKindOf, type JobKind } from "@/features/job-kinds/job-kinds";

/**
 * A group event in its own words. A cheer day has athletes and the parents
 * who pay for them; a mini-session day has families booking a time; anything
 * else, people. Read from the job's kind (features/job-kinds), so a studio
 * sets nothing: the roster on a "Family & portraits" job speaks of families.
 */
export type GroupEventWords = {
  /** "athlete", "family", "person". */
  person: string;
  persons: string;
  /** Who pays and is sent things: "parent", "family", "person". */
  payer: string;
  payers: string;
  /** The field for who is in the photos. */
  personLabel: string;
  personHint: string | null;
  /** The parent's own section on the sign-up page, and the studio's field for them. */
  payerLabel: string;
  studioPayerLabel: string;
  /** Team or group: a cheer day has squads; a family has none. */
  teamLabel: string | null;
  /** The sign-up page's section for who's in the photos. */
  personSection: string;
  /** The consent line's opening, before the studio's name. */
  consentLead: string;
  /** The button: sign up for a team day, book for a mini-session day. */
  act: "Sign up" | "Book";
  /** "Each parent pays?" on the roster's invitation card. */
  rosterPrompt: string;
  rosterLead: string;
};

const SPORTS: GroupEventWords = {
  person: "athlete",
  persons: "athletes",
  payer: "parent",
  payers: "parents",
  personLabel: "Athlete’s name",
  personHint: null,
  payerLabel: "Your name",
  studioPayerLabel: "Parent’s name",
  teamLabel: "Team or group",
  personSection: "The athlete",
  consentLead: "I’m the athlete’s parent or guardian",
  act: "Sign up",
  rosterPrompt: "Each parent pays?",
  rosterLead:
    "List every athlete and parent, take each payment on the day or before, and email each parent their own receipt. The organizer stays the job’s contact.",
};

const PORTRAITS: GroupEventWords = {
  person: "family",
  persons: "families",
  payer: "family",
  payers: "families",
  personLabel: "Who’s in the photos",
  personHint: "For example, the Garcia family",
  payerLabel: "Your name",
  studioPayerLabel: "Booked by",
  teamLabel: null,
  personSection: "Your session",
  consentLead: "I’m booking this session and am a parent or guardian of anyone under 18 in the photos",
  act: "Book",
  rosterPrompt: "A mini-session day?",
  rosterLead:
    "Each family books a time and pays for their own session. Share a link or a QR code, take payments on the day, and email each family their receipt.",
};

const OTHER: GroupEventWords = {
  person: "person",
  persons: "people",
  payer: "person",
  payers: "people",
  personLabel: "Name for the photos",
  personHint: null,
  payerLabel: "Your name",
  studioPayerLabel: "Booked by",
  teamLabel: "Group",
  personSection: "Who’s in the photos",
  consentLead: "I’m signing up and am a parent or guardian of anyone under 18 in the photos",
  act: "Sign up",
  rosterPrompt: "Each person pays?",
  rosterLead:
    "List everyone who's paying for their own photos, take each payment on the day or before, and email each one their receipt.",
};

const BY_KIND: Partial<Record<JobKind, GroupEventWords>> = { sports: SPORTS, portraits: PORTRAITS };

/** The words for a job (or a kind already worked out). */
export function groupEventWords(source: unknown): GroupEventWords {
  const kind = typeof source === "string" ? (source as JobKind) : jobKindOf(source);
  return BY_KIND[kind] ?? OTHER;
}

/** "parents" → "Parents", for the start of a sentence. */
export function capitalized(word: string): string {
  return word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word;
}

/**
 * What a group event delivers afterwards, per person (features/group-events/delivery.ts).
 * Offered only to a studio whose trade delivers — a photographer's
 * (features/trades tradeProfile().delivery) — so these are a photographer's
 * words, kept here with the event's other words rather than in the screens.
 */
export const GROUP_DELIVERY_WORDS = {
  /** Mid-sentence: "18 of 24 have their photos". */
  noun: "photos",
  /** The roster section and the order page card. */
  heading: "Photos",
  yours: "Your photos",
  open: "Open your photos",
  /** The link's field: a gallery or a shared folder. */
  linkLabel: "Photos link",
  linkHint: "A gallery or a shared folder link, starting with https://",
  /** A team set: the same link for everyone. */
  oneLinkLead: "A team gallery: the same link for everyone on the roster",
} as const;
