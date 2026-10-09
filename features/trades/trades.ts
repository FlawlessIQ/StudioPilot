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
  /** The sales call before the proposal: "Consultation", a DJ's "Vibe call". */
  consultation: string;
  /** The call before the day: "Final details call", a DJ's "Final planning call". */
  finalCall: string;
  /** The planning form's name, when the trade names it its own way; null keeps the job kind's ("Wedding details"). */
  detailsForm: string | null;
  /**
   * The client's day-before checklist, when the trade has its own: the ask and
   * what to have ready. Null keeps a photographer's (the dress on a hanger,
   * the rings together), which reads by the kind of job.
   */
  dayBefore: { lead: string; ask: string; items: readonly string[] } | null;
  /** What the client is sent to book: a photographer's "Proposal", a makeup artist's "Quote". */
  proposal: string;
  /**
   * The studio's own checklist the day before, when the trade packs a kit:
   * on the journey and in the crew's reminder (a makeup artist's brushes and
   * lashes, the address and parking). Null for a trade with none.
   */
  kitChecklist: { title: string; items: readonly string[] } | null;
  /** The trial before the day, when the trade has one: "Makeup trial". */
  trial: string | null;
  /**
   * The prep guide in the week-before email, when the trade has one: how to
   * arrive for the chair (a clean face, dry hair, a button-up top).
   */
  prepGuide: { lead: string; items: readonly string[] } | null;
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
    consultation: "Consultation",
    finalCall: "Final details call",
    detailsForm: null,
    dayBefore: null,
    proposal: "Proposal",
    kitChecklist: null,
    trial: null,
    prepGuide: null,
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
    consultation: "Vibe call",
    finalCall: "Final planning call",
    detailsForm: "Music & moments planner",
    dayBefore: {
      lead: "To help the night run smoothly",
      ask: "One small ask so everything runs to time — before we arrive, please make sure we have:",
      items: [
        "any last song changes, by replying to this email today",
        "the venue coordinator's name and number for the day",
        "where we load in and park, if the venue has told you",
      ],
    },
    proposal: "Proposal",
    kitChecklist: null,
    trial: null,
    prepGuide: null,
  },
  makeup: {
    provider: "makeup artist",
    business: "makeup business",
    crew: "artists",
    crewStep: "Artists confirmed",
    didIt: "Yes, it's done",
    doneLabel: "Done",
    dayDone: "All done",
    planOfDay: "Getting-ready schedule",
    lead: "Lead artist",
    ownerOn: "You're doing this one",
    ownerOnAction: "I'm doing it",
    afterPhase: "Afterwards",
    consultation: "Consultation",
    finalCall: "Final details call",
    detailsForm: "Party list",
    dayBefore: null,
    proposal: "Quote",
    kitChecklist: {
      title: "Kit checklist",
      items: [
        "the address, room number and parking",
        "the getting-ready schedule and who sits first",
        "brushes and sponges cleaned",
        "lashes and adhesive for everyone who wanted them",
        "the bride's foundation shade and products from the trial",
        "a touch-up kit for the bride",
        "a light, a power strip and an extension cord",
      ],
    },
    trial: "Makeup trial",
    prepGuide: {
      lead: "So your makeup goes on beautifully and lasts all day",
      items: [
        "arrive with a clean, moisturized face and no makeup",
        "wear a button-up or zip-front top, so nothing goes over your head",
        "have your inspiration photos and any lashes you love with you",
      ],
    },
  },
  hair: {
    provider: "hair stylist",
    business: "hair business",
    crew: "stylists",
    crewStep: "Stylists confirmed",
    didIt: "Yes, it's done",
    doneLabel: "Done",
    dayDone: "All done",
    planOfDay: "Getting-ready schedule",
    lead: "Lead stylist",
    ownerOn: "You're styling this one",
    ownerOnAction: "I'm styling it",
    afterPhase: "Afterwards",
    consultation: "Consultation",
    finalCall: "Final details call",
    detailsForm: "Party list",
    dayBefore: null,
    proposal: "Quote",
    kitChecklist: {
      title: "Kit checklist",
      items: [
        "the address, room number and parking",
        "the getting-ready schedule and who sits first",
        "irons, dryer and brushes",
        "pins, elastics and hairspray",
        "extensions, matched to the color from the trial",
        "the bride's look from the trial",
        "a power strip and an extension cord",
      ],
    },
    trial: "Hair trial",
    prepGuide: {
      lead: "So your hair holds all day",
      items: [
        "come with clean, completely dry hair and no oils or products, unless your stylist told you otherwise",
        "wear a button-up or zip-front top, so nothing goes over your head",
        "have your veil and hair accessories with you",
      ],
    },
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
   * The client's day-before checklist email: a photographer's dress on a
   * hanger, a DJ's last song changes and load-in (tradeVocab `dayBefore`).
   * Makeup and hair get a prep guide instead (Phase 3).
   */
  clientDayBefore: boolean;
  /**
   * A sales call before the quote. A makeup artist or hair stylist has none:
   * the trial does that job (docs/vendor-journeys.md), so an inquiry goes
   * straight to the quote, as a family session does (job-kinds.ts).
   */
  consultation: boolean;
  /** A trial appointment before the day (Phase 3). */
  trial: boolean;
  /** Services are priced per person (Phase 3). */
  perPersonPricing: boolean;
  /** The plan of the day is a getting-ready chair schedule (Phase 3). */
  chairSchedule: boolean;
  /** The planning form is a music and moments planner (Phase 2). */
  musicPlanner: boolean;
  /**
   * The planning timeline a new studio of this trade starts with
   * (planning-timeline.ts). A DJ sends the planner at booking and locks it
   * ten days out, so the final planning call falls about a week before.
   * Null keeps the defaults (a photographer's six months and four weeks).
   */
  planning: { formAtBooking: boolean; lockDaysBefore: number } | null;
  /**
   * Days before the event the final balance falls due. Fourteen for a
   * photographer or a DJ; a makeup artist or hair stylist is paid on the day
   * (docs/vendor-journeys.md), so zero: the bill still goes out four weeks
   * ahead, due the morning of.
   */
  balanceDueDaysBefore: number;
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
    consultation: true,
    trial: false,
    perPersonPricing: false,
    chairSchedule: false,
    musicPlanner: false,
    planning: null,
    balanceDueDaysBefore: 14,
    coverageRoles: ["photographer", "videographer"],
    plans: ["studio", "multi_brand"],
  },
  dj: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: true,
    consultation: true,
    trial: false,
    perPersonPricing: false,
    chairSchedule: false,
    musicPlanner: true,
    planning: { formAtBooking: true, lockDaysBefore: 10 },
    balanceDueDaysBefore: 14,
    coverageRoles: ["dj"],
    plans: ["vendor"],
  },
  makeup: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    consultation: false,
    trial: true,
    perPersonPricing: true,
    chairSchedule: true,
    musicPlanner: false,
    planning: { formAtBooking: true, lockDaysBefore: 30 },
    balanceDueDaysBefore: 0,
    coverageRoles: ["makeup_artist"],
    plans: ["vendor"],
  },
  hair: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    consultation: false,
    trial: true,
    perPersonPricing: true,
    chairSchedule: true,
    musicPlanner: false,
    planning: { formAtBooking: true, lockDaysBefore: 30 },
    balanceDueDaysBefore: 0,
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
