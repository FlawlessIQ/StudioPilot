/**
 * Trades: what the studio itself does.
 *
 * docs/vendor-journeys-plan.md (Conor, 2026-10-08). A photographer, a DJ, a
 * makeup artist and a hair stylist all run the same StudioCue journey:
 * inquiry, proposal, agreement, retainer, planning form, plan of the day,
 * the day, review. The trade decides only the words, which steps apply,
 * their defaults and the starter content. It's the studio's, set once at
 * signup (`tenants/{id}.trade`). The job's kind (job-kinds.ts) is the job's.
 * A DJ playing a corporate party is trade "dj", kind "corporate".
 *
 * Screens never branch on the trade (`if (trade === "dj")`); they look it up
 * here: `tradeVocab(trade)`, `tradeProfile(trade)`. A missing trade is
 * "photographer", so every studio from before trades existed reads as it
 * always did.
 *
 * functions/src/trades/trades.ts mirrors everything below the marker;
 * tests/trades.test.ts compares the two. No imports, so the mirror needs none.
 */
// ── mirrored below ──

export const TRADES = ["photographer", "dj", "makeup", "hair"] as const;
export type Trade = (typeof TRADES)[number];

export const DEFAULT_TRADE: Trade = "photographer";

/** How a trade is named in pickers, filters and the Console. */
export const TRADE_LABELS: Record<Trade, string> = {
  photographer: "Photography",
  dj: "DJ",
  makeup: "Makeup",
  hair: "Hair",
};

/** The signup question, "What do you do?". */
export const TRADE_OPTIONS: ReadonlyArray<{ value: Trade; label: string; hint: string }> = [
  { value: "photographer", label: "Photography or video", hint: "Weddings, sessions, events" },
  { value: "dj", label: "DJ", hint: "Weddings and events, with MC" },
  { value: "makeup", label: "Makeup", hint: "Bridal and event makeup" },
  { value: "hair", label: "Hair", hint: "Bridal and event hair" },
];

/**
 * Trades whose journey is live: offered at signup, and whose vendors are
 * invited to try StudioCue (saas/vendor-invites.ts). A trade not yet live can
 * still be opened with `?trade=` for a walk, but is never offered or invited.
 */
export const LIVE_TRADES: readonly Trade[] = ["photographer"];

/** Makeup and hair are separate trades on one shared "beauty" core. */
export type TradeFamily = "photo" | "music" | "beauty";
export const TRADE_FAMILY: Record<Trade, TradeFamily> = {
  photographer: "photo",
  dj: "music",
  makeup: "beauty",
  hair: "beauty",
};

const tradeText = (value: unknown): string => (typeof value === "string" ? value.trim().toLowerCase() : "");

export function isTrade(value: unknown): value is Trade {
  return (TRADES as readonly string[]).includes(tradeText(value));
}

/** A studio's trade, from the tenant (or a bare value). Missing or unknown is a photographer. */
export function tradeOf(source: unknown): Trade {
  const value =
    source && typeof source === "object" ? (source as { trade?: unknown }).trade : source;
  const trade = tradeText(value);
  return isTrade(trade) ? (trade as Trade) : DEFAULT_TRADE;
}

export function isLiveTrade(trade: unknown): boolean {
  return LIVE_TRADES.includes(tradeOf(trade));
}

// ── Words ────────────────────────────────────────────────────────────────

export type TradeVocabulary = {
  /** "photographer", "DJ", "makeup artist" — mid-sentence, as the client says it. */
  provider: string;
  /** "photography studio", "DJ business" — what the studio is. */
  business: string;
  /** The crew, as a plural noun: "crew", "DJs", "artists", "stylists". */
  crew: string;
  /** The journey's crew step. */
  crewStep: string;
  /** Confirming the day happened. */
  didIt: string;
  /** EVENT_COMPLETE, as a status. */
  doneLabel: string;
  /** The event-day step once it's behind them. */
  dayDone: string;
  /** The plan of the day, when the trade names it its own way; null keeps the job kind's word. */
  planOfDay: string | null;
  /** Who leads on the day, as a label: "Lead photographer", "Lead DJ". */
  lead: string;
  /** The owner doing the job themselves: "You're shooting this one". */
  ownerOn: string;
  /** The button that says so: "I'm shooting it". */
  ownerOnAction: string;
  /** The phase after the day: "Delivery" when something is delivered, otherwise "Afterwards". */
  afterPhase: string;
};

const VOCAB: Record<Trade, TradeVocabulary> = {
  photographer: {
    provider: "photographer",
    business: "photography studio",
    crew: "crew",
    crewStep: "Crew confirmed",
    didIt: "Yes, we shot it",
    doneLabel: "Shot",
    dayDone: "Covered",
    planOfDay: null,
    lead: "Lead photographer",
    ownerOn: "You're shooting this one",
    ownerOnAction: "I'm shooting it",
    afterPhase: "Delivery",
  },
  dj: {
    provider: "DJ",
    business: "DJ business",
    crew: "DJs",
    crewStep: "DJ assigned",
    didIt: "Yes, we played it",
    doneLabel: "Played",
    dayDone: "Played",
    planOfDay: "Run of show & MC script",
    lead: "Lead DJ",
    ownerOn: "You're playing this one",
    ownerOnAction: "I'm playing it",
    afterPhase: "Afterwards",
  },
  makeup: {
    provider: "makeup artist",
    business: "makeup business",
    crew: "artists",
    crewStep: "Artists confirmed",
    didIt: "Yes, it's done",
    doneLabel: "Done",
    dayDone: "Done",
    planOfDay: "Getting-ready schedule",
    lead: "Lead artist",
    ownerOn: "You're doing this one",
    ownerOnAction: "I'm doing it",
    afterPhase: "Afterwards",
  },
  hair: {
    provider: "hair stylist",
    business: "hair business",
    crew: "stylists",
    crewStep: "Stylists confirmed",
    didIt: "Yes, it's done",
    doneLabel: "Done",
    dayDone: "Done",
    planOfDay: "Getting-ready schedule",
    lead: "Lead stylist",
    ownerOn: "You're styling this one",
    ownerOnAction: "I'm styling it",
    afterPhase: "Afterwards",
  },
};

/** The words for a trade. */
export function tradeVocab(trade: unknown): TradeVocabulary {
  return VOCAB[tradeOf(trade)];
}

// ── What applies ─────────────────────────────────────────────────────────

export type TradeProfile = {
  trade: Trade;
  family: TradeFamily;
  /** Something is delivered after the day (a gallery, a film). Without it the job goes from the day to the review. */
  delivery: boolean;
  /** An album can be part of the package. */
  album: boolean;
  /** A shot list is part of planning. */
  shotList: boolean;
  /**
   * The client's day-before checklist email ("the dress on a hanger, ready to
   * photograph"). Photography's for now; DJs get load-in details (Phase 2) and
   * makeup and hair a prep guide (Phase 3) instead.
   */
  clientDayBefore: boolean;
  /** A trial appointment before the day (Phase 3). */
  trial: boolean;
  /** Services are priced per person (Phase 3). */
  perPersonPricing: boolean;
  /** The plan of the day is a getting-ready chair schedule (Phase 3). */
  chairSchedule: boolean;
  /** The planning form is a music and moments planner (Phase 2). */
  musicPlanner: boolean;
  /** Days before the event the final details call is offered; null keeps the studio's planning timeline. */
  finalCallDaysBefore: number | null;
  /** The roles a package's coverage is staffed with. */
  coverageRoles: readonly string[];
  /** The subscription plans this trade can buy (config/saas-plans.ts). */
  plans: readonly string[];
};

const PROFILES: Record<Trade, Omit<TradeProfile, "trade" | "family">> = {
  photographer: {
    delivery: true,
    album: true,
    shotList: true,
    clientDayBefore: true,
    trial: false,
    perPersonPricing: false,
    chairSchedule: false,
    musicPlanner: false,
    finalCallDaysBefore: null,
    coverageRoles: ["photographer", "videographer"],
    plans: ["studio", "multi_brand"],
  },
  dj: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    trial: false,
    perPersonPricing: false,
    chairSchedule: false,
    musicPlanner: true,
    finalCallDaysBefore: 7,
    coverageRoles: ["dj"],
    plans: ["vendor"],
  },
  makeup: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    trial: true,
    perPersonPricing: true,
    chairSchedule: true,
    musicPlanner: false,
    finalCallDaysBefore: null,
    coverageRoles: ["makeup_artist"],
    plans: ["vendor"],
  },
  hair: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    trial: true,
    perPersonPricing: true,
    chairSchedule: true,
    musicPlanner: false,
    finalCallDaysBefore: null,
    coverageRoles: ["hair_stylist"],
    plans: ["vendor"],
  },
};

/** What a trade's journey has. */
export function tradeProfile(trade: unknown): TradeProfile {
  const resolved = tradeOf(trade);
  return { trade: resolved, family: TRADE_FAMILY[resolved], ...PROFILES[resolved] };
}

/**
 * The moves a trade with nothing to deliver makes after the day: straight to
 * the review, or closed. A photographer still goes through editing and
 * delivery (POST_PRODUCTION → DELIVERED, evidence-controlled).
 */
export const NO_DELIVERY_MOVES: Readonly<Record<string, readonly string[]>> = {
  EVENT_COMPLETE: ["REVIEW_REQUESTED", "CLOSED"],
};

/** Moves this trade adds to the state machine (state-machine.ts), from `from`. */
export function tradeMoves(trade: unknown, from: string): readonly string[] {
  return tradeProfile(trade).delivery ? [] : (NO_DELIVERY_MOVES[from] ?? []);
}

/**
 * The trades a vendor on a job would sign up as, by vendor type
 * (features/vendors/schema.ts). A "hair_makeup" vendor could be either. A
 * type with none (a florist, a caterer) has no StudioCue journey yet.
 */
export const VENDOR_TYPE_TRADES: Readonly<Record<string, readonly Trade[]>> = {
  videographer: ["photographer"],
  dj: ["dj"],
  band: [],
  hair_makeup: ["makeup", "hair"],
  planner: [],
  florist: [],
  caterer: [],
  transportation: [],
  other: [],
};

/** Whether a vendor of this type has a live trade to be invited to. */
export function vendorTypeIsLive(type: unknown): boolean {
  return (VENDOR_TYPE_TRADES[String(type ?? "")] ?? []).some((trade) => LIVE_TRADES.includes(trade));
}
