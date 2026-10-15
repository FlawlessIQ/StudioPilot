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

export const TRADES = ["photographer", "dj", "makeup", "hair", "planner"] as const;
export type Trade = (typeof TRADES)[number];

export const DEFAULT_TRADE: Trade = "photographer";

/** How a trade is named in pickers, filters and the Console. */
export const TRADE_LABELS: Record<Trade, string> = {
  photographer: "Photography",
  dj: "DJ",
  makeup: "Makeup",
  hair: "Hair",
  planner: "Planning",
};

/** The signup question, "What do you do?". */
export const TRADE_OPTIONS: ReadonlyArray<{ value: Trade; label: string; hint: string }> = [
  { value: "photographer", label: "Photography or video", hint: "Weddings, sessions, events" },
  { value: "dj", label: "DJ", hint: "Weddings and events, with MC" },
  { value: "makeup", label: "Makeup", hint: "Bridal and event makeup" },
  { value: "hair", label: "Hair", hint: "Bridal and event hair" },
  { value: "planner", label: "Wedding planner", hint: "Planning and day-of coordination" },
];

/**
 * Trades whose journey is live: offered at signup, and whose vendors are
 * invited to try StudioCue (saas/vendor-invites.ts). A trade not yet live can
 * still be opened with `?trade=` for a walk, but is never offered or invited.
 * DJ, makeup and hair went live together on 2026-10-12 (vendor journeys,
 * Phase 6), with their landing pages (/dj, /makeup, /hair).
 */
export const LIVE_TRADES: readonly Trade[] = ["photographer", "dj", "makeup", "hair", "planner"];
// The wedding planner went live with its page (/planner) in Phase 5 of
// docs/planner-journey-plan.md (2026-10-13).

/** Makeup and hair are separate trades on one shared "beauty" core. */
export type TradeFamily = "photo" | "music" | "beauty" | "planning";
export const TRADE_FAMILY: Record<Trade, TradeFamily> = {
  photographer: "photo",
  dj: "music",
  makeup: "beauty",
  hair: "beauty",
  planner: "planning",
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
  dayBefore: {
    lead: string;
    ask: string;
    items: readonly string[];
    /** The day-before step's line before it goes, and once it has: "Last song changes, venue contact, load-in". */
    summary: string;
    sent: string;
  } | null;
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
  /** When the trial is best booked, when the trade says: a hair trial waits for the veil. */
  trialHint: string | null;
  /**
   * What the client brings to the trial, as a list that reads after "Bring":
   * on the invitation, the confirmation and the reminder. A trial is in
   * person, so its confirmation says what to have with you rather than a
   * call's "final meeting details" (Priya Shah, Jess Styles Bridal, prod walk
   * 2026-10-12). Null for a trade with no trial.
   */
  trialBring: readonly string[] | null;
  /**
   * The prep guide in the week-before email, when the trade has one: how to
   * arrive for the chair (a clean face, dry hair, a button-up top).
   */
  prepGuide: { lead: string; items: readonly string[] } | null;
  /** What the studio provides, mid-sentence: "photography", "music", "makeup", "hair" ("any {service} rules at the venue"). */
  service: string;
  /** One of the crew, studio-side: "photographer", "DJ", "artist", "stylist" ("Staff {member}"). */
  member: string;
  /**
   * What a package's people and hours are called: a photographer's
   * "Coverage" ("Base coverage", "Coverage: 2 photographers, 8 hours"); a
   * vendor's "Service".
   */
  coverage: string;
  /** The package form's hours field: "Coverage hours", "Hours of music", "Hours on site". */
  hoursLabel: string;
  /** What a package lists as included: a photographer's "Deliverables", a vendor's "What's included". */
  includedLabel: string;
  /** What the crew does at an event, as a verb: "shoot", "play", "work" ("the kind of event they {verb}"). */
  verb: string;
  /** The day itself on the journey: a photographer's "Event day", a DJ's "The night", a makeup artist's "The morning". */
  dayName: string;
  /**
   * The payment that books the date, lowercase mid-sentence: a photographer's
   * "retainer", a vendor's "deposit" — what a DJ's, makeup artist's or hair
   * stylist's client calls it (vendor wording sweep, Riley Park, 2026-10-10).
   */
  deposit: string;
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
    trialHint: null,
    trialBring: null,
    prepGuide: null,
    service: "photography",
    member: "photographer",
    coverage: "Coverage",
    hoursLabel: "Coverage hours",
    includedLabel: "Deliverables",
    verb: "shoot",
    dayName: "Event day",
    deposit: "retainer",
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
      summary: "Last song changes, venue contact, load-in",
      sent: "Sent — last song changes and load-in",
    },
    proposal: "Proposal",
    kitChecklist: null,
    trial: null,
    trialHint: null,
    trialBring: null,
    prepGuide: null,
    service: "music",
    member: "DJ",
    coverage: "Service",
    hoursLabel: "Hours of music",
    includedLabel: "What's included",
    verb: "play",
    dayName: "The night",
    deposit: "deposit",
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
    trialHint: null,
    trialBring: ["pictures of looks you love"],
    prepGuide: {
      lead: "So your makeup goes on beautifully and lasts all day",
      items: [
        "arrive with a clean, moisturized face and no makeup",
        "wear a button-up or zip-front top, so nothing goes over your head",
        "have your inspiration photos and any lashes you love with you",
      ],
    },
    service: "makeup",
    member: "artist",
    coverage: "Service",
    hoursLabel: "Hours on site",
    includedLabel: "What's included",
    verb: "work",
    dayName: "The morning",
    deposit: "deposit",
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
    trialHint: "best once the veil is chosen, so the style is built around it",
    trialBring: ["pictures of looks you love", "your veil or hairpiece", "any hair accessories you'll wear"],
    prepGuide: {
      lead: "So your hair holds all day",
      items: [
        "come with clean, completely dry hair — washed the night before, with no oils or products — or there's a blow-dry fee",
        "wear a button-up or zip-front top, so nothing goes over your head",
        "have your veil and hair accessories with you",
      ],
    },
    service: "hair",
    member: "stylist",
    coverage: "Service",
    hoursLabel: "Hours on site",
    includedLabel: "What's included",
    verb: "work",
    dayName: "The morning",
    deposit: "deposit",
  },
  planner: {
    provider: "planner",
    business: "planning business",
    crew: "assistants",
    crewStep: "Assistants confirmed",
    didIt: "Yes, we ran it",
    doneLabel: "Done",
    dayDone: "Ran the day",
    planOfDay: "Master timeline",
    lead: "Lead planner",
    ownerOn: "You're running this one",
    ownerOnAction: "I'm running it",
    afterPhase: "Afterwards",
    consultation: "Discovery call",
    // A planner's last meeting is the venue walkthrough (`walkthrough`); a
    // final call is the studio's to turn on, and is named as a photographer's.
    finalCall: "Final details call",
    detailsForm: "Final details",
    dayBefore: {
      lead: "For the rehearsal and the big day",
      ask: "A few things so tomorrow runs to time — before the rehearsal, please have ready:",
      items: [
        "everyone in the ceremony at the rehearsal, on time",
        "the marriage license and the rings, together, for us to hold",
        "the vendor tips and final payments in labeled envelopes, if we're handing them out",
        "your décor and personal items boxed and labeled for setup",
      ],
      summary: "The rehearsal, the license and rings, the tip envelopes",
      sent: "Sent — the rehearsal and what to bring",
    },
    proposal: "Proposal",
    kitChecklist: {
      title: "Emergency kit",
      items: [
        "the master timeline and the vendor contact sheet, printed",
        "the payments and tips to hand out, in labeled envelopes",
        "a sewing kit, safety pins and fashion tape",
        "stain remover, a lint roller and tissues",
        "pain relievers, bandages and blister pads",
        "scissors, tape, zip ties and a lighter",
        "phone chargers and a power bank",
      ],
    },
    trial: null,
    trialHint: null,
    trialBring: null,
    prepGuide: null,
    service: "planning",
    member: "coordinator",
    coverage: "Service",
    hoursLabel: "Hours on the day",
    includedLabel: "What's included",
    verb: "work",
    dayName: "The wedding",
    deposit: "retainer",
  },
};

/** The words for a trade. */
/**
 * A trade's words for a kind of job, where they differ from its wedding's
 * (docs/mitzvah-journey-plan-2026-10-14.md). Keyed by the kind's id as text,
 * since this file has no imports (job-kinds.ts `JobKind`). A mitzvah's
 * family has no bride, no veil and no marriage license.
 */
const KIND_VOCAB: Partial<Record<Trade, Readonly<Record<string, Partial<TradeVocabulary>>>>> = {
  // The recommended form's own name (recommended-templates.ts), so the job's
  // journey, the portal and Questionnaires name the form the family gets.
  dj: {
    mitzvah: { detailsForm: "Mitzvah music & MC planner" },
  },
  makeup: {
    mitzvah: {
      kitChecklist: {
        title: "Kit checklist",
        items: [
          "the address, room number and parking",
          "the getting-ready schedule and who sits first",
          "brushes and sponges cleaned",
          "lashes and adhesive for everyone who wanted them",
          "each person's shades and products, from the trial if there was one",
          "a touch-up kit for the family",
          "a light, a power strip and an extension cord",
        ],
      },
    },
  },
  hair: {
    mitzvah: {
      kitChecklist: {
        title: "Kit checklist",
        items: [
          "the address, room number and parking",
          "the getting-ready schedule and who sits first",
          "irons, dryer and brushes",
          "pins, elastics and hairspray",
          "each look from the trial, if there was one",
          "a power strip and an extension cord",
        ],
      },
      trialHint: null,
      trialBring: ["pictures of looks you love", "any hair accessories you'll wear"],
      prepGuide: {
        lead: "So your hair holds all day",
        items: [
          "come with clean, completely dry hair — washed the night before, with no oils or products — or there's a blow-dry fee",
          "wear a button-up or zip-front top, so nothing goes over your head",
          "have your hair accessories with you",
        ],
      },
    },
  },
  planner: {
    mitzvah: {
      dayName: "The celebration",
      dayBefore: {
        lead: "For the big day",
        ask: "A few things so tomorrow runs to time — please have ready:",
        items: [
          "the candle-lighting list, final and in order, with who lights each candle",
          "the tallit, kippot and anything for the service or the portraits",
          "the vendor tips and final payments in labeled envelopes, if we're handing them out",
          "your décor, the sign-in board and the favors boxed and labeled for setup",
        ],
        summary: "The candle list, the tip envelopes, the décor",
        sent: "Sent — the candle list and what to bring",
      },
    },
  },
};

/**
 * A trade's words. Pass the job's kind where it is at hand: a mitzvah's
 * planner names the celebration, not the wedding.
 */
export function tradeVocab(trade: unknown, kind?: unknown): TradeVocabulary {
  const base = VOCAB[tradeOf(trade)];
  const key = typeof kind === "string" ? kind.trim().toLowerCase() : "";
  const override = key ? KIND_VOCAB[tradeOf(trade)]?.[key] : undefined;
  return override ? { ...base, ...override } : base;
}

// ── What applies ─────────────────────────────────────────────────────────

export type TradeJourney = {
  /** The quote waits for the sales call. A DJ's vibe call is offered, never required. */
  callRequired: boolean;
  /** Sign the agreement and pay the deposit in one link (the combined agreement). */
  oneLinkBooking: boolean;
  /** Insurance to the venue on every job; otherwise only when the venue asks. */
  insuranceByDefault: boolean;
  /** A crew step even when the studio covers the job alone. */
  crewByDefault: boolean;
  /** The client approves the day's schedule; otherwise it is published for them to read. */
  scheduleApproval: boolean;
  /** One planning form (the party list, the music planner), and the day's plan drawn from it. */
  oneForm: boolean;
  /** The balance is collected on the day, not invoiced before it. */
  balanceOnTheDay: boolean;
  /** The review is asked after the day itself: nothing is delivered first. */
  reviewAfterDay: boolean;
  /**
   * Readiness checks: the photographer's twelve, the four a vendor needs, or
   * a planner's five (the vendor team complete and confirmed in place of the
   * day's plan; starter-templates.ts).
   */
  readiness: "full" | "essentials" | "planner";
  /** Routine steps (the first reply, the day-before note, the kit) fold into the steps beside them. */
  foldRoutine: boolean;
  /**
   * The wedding's vendor team is part of the journey: a "Vendor team" step
   * (every needed category booked) and a "Vendors confirmed" step (the
   * timeline sent to every booked vendor and confirmed), which the plan of
   * the day folds into. A planner's (docs/planner-journey-plan.md, N3).
   */
  vendorSteps: boolean;
  /** A venue walkthrough with the couple, 4–6 weeks out, is a step of its own (a planner's). */
  walkthrough: boolean;
};

/** A photographer's journey, as it has always been. */
const FULL_JOURNEY: TradeJourney = {
  callRequired: true,
  oneLinkBooking: false,
  insuranceByDefault: true,
  crewByDefault: true,
  scheduleApproval: true,
  oneForm: false,
  balanceOnTheDay: false,
  reviewAfterDay: false,
  readiness: "full",
  foldRoutine: false,
  vendorSteps: false,
  walkthrough: false,
};

/** A vendor's: book in one link, one form, nothing to approve, the checks that matter. */
const LIGHT_JOURNEY: TradeJourney = {
  callRequired: false,
  oneLinkBooking: true,
  insuranceByDefault: false,
  crewByDefault: false,
  scheduleApproval: false,
  oneForm: true,
  balanceOnTheDay: false,
  reviewAfterDay: true,
  readiness: "essentials",
  foldRoutine: true,
  vendorSteps: false,
  walkthrough: false,
};

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
  /**
   * How long a trial takes, in minutes, so every time a client is offered
   * ends inside the studio's hours. The studio's consultation length is a
   * sales call's: a hair trial of about two hours was offered at 4:00 PM
   * against hours ending at 5:00 PM (Priya Shah, Jess Styles Bridal,
   * 2026-10-10). A trade default for now; null for a trade with no trial.
   */
  trialMinutes: number | null;
  /**
   * How long a venue walkthrough takes, in minutes, for a trade that holds
   * one (a planner's, 4–6 weeks out): the time each opening offered must fit,
   * as `trialMinutes` does for a trial. Null for a trade with none.
   */
  walkthroughMinutes: number | null;
  /** Services are priced per person (Phase 3). */
  perPersonPricing: boolean;
  /**
   * Hair extensions can be part of the booking (Phase 5): the plan and the
   * color match are logged at the trial, an order is due 8 weeks out, and
   * rentals come back after the day.
   */
  extensions: boolean;
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
  planning: {
    formAtBooking: boolean;
    lockDaysBefore: number;
    /** When the form goes, in months before; absent keeps the default (six). */
    formMonthsBefore?: number;
    /** "auto": StudioCue sends it on its day; absent keeps "remind". */
    formSend?: "remind" | "auto";
    /** The final details call at the lock; absent keeps it on. */
    finalCall?: boolean;
  } | null;
  /**
   * Days before the event the final balance falls due. Fourteen for a
   * photographer or a DJ; a makeup artist or hair stylist is paid on the day
   * (docs/vendor-journeys.md), so zero: the bill still goes out four weeks
   * ahead, due the morning of.
   */
  balanceDueDaysBefore: number;
  /**
   * How light this trade's journey is. Conor, 2026-10-09: "the vendor journey
   * is less complicated than the photographer journey and should be easier
   * and less burdensome" — and it had been built from the photographer's, 14
   * steps to 15. Each flag here turns a photographer default off for the
   * trade; nothing is removed, and a job that needs one turns it back on
   * (job-kinds.ts `journeyFor` reads them with the kind of job).
   */
  journey: TradeJourney;
  /** The roles a package's coverage is staffed with. */
  coverageRoles: readonly string[];
  /**
   * A package says how much of the planning it covers: full, partial or
   * month-of coordination (features/planning/planning-scope.ts). A planner's.
   */
  planningScope: boolean;
  /**
   * A wedding's vendor team on the job (features/vendors/team.ts).
   * "default": the panel is always on the job, for the trade whose work it
   * is (the planner, Phase 2 of docs/planner-journey-plan.md). "quiet":
   * every trade today. The job shows only a small "Add a vendor" until a
   * vendor is on it (Conor's decision 3, 2026-10-12).
   */
  vendorTeam: "default" | "quiet";
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
    trialMinutes: null,
    walkthroughMinutes: null,
    perPersonPricing: false,
    extensions: false,
    chairSchedule: false,
    musicPlanner: false,
    planning: null,
    balanceDueDaysBefore: 14,
    journey: FULL_JOURNEY,
    coverageRoles: ["photographer", "videographer"],
    planningScope: false,
    vendorTeam: "quiet",
    plans: ["studio", "multi_brand"],
  },
  dj: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: true,
    consultation: true,
    trial: false,
    trialMinutes: null,
    walkthroughMinutes: null,
    perPersonPricing: false,
    extensions: false,
    chairSchedule: false,
    musicPlanner: true,
    planning: { formAtBooking: true, lockDaysBefore: 10 },
    balanceDueDaysBefore: 14,
    journey: LIGHT_JOURNEY,
    coverageRoles: ["dj"],
    planningScope: false,
    vendorTeam: "quiet",
    plans: ["vendor"],
  },
  makeup: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    consultation: false,
    trial: true,
    trialMinutes: 90,
    walkthroughMinutes: null,
    perPersonPricing: true,
    extensions: false,
    chairSchedule: true,
    musicPlanner: false,
    planning: { formAtBooking: true, lockDaysBefore: 30 },
    balanceDueDaysBefore: 0,
    journey: { ...LIGHT_JOURNEY, balanceOnTheDay: true },
    coverageRoles: ["makeup_artist"],
    planningScope: false,
    vendorTeam: "quiet",
    plans: ["vendor"],
  },
  hair: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: false,
    consultation: false,
    trial: true,
    trialMinutes: 120,
    walkthroughMinutes: null,
    perPersonPricing: true,
    extensions: true,
    chairSchedule: true,
    musicPlanner: false,
    planning: { formAtBooking: true, lockDaysBefore: 30 },
    balanceDueDaysBefore: 0,
    journey: { ...LIGHT_JOURNEY, balanceOnTheDay: true },
    coverageRoles: ["hair_stylist"],
    planningScope: false,
    vendorTeam: "quiet",
    plans: ["vendor"],
  },
  /**
   * A wedding planner (docs/planner-journey-plan.md, Phase 2). Nothing is
   * delivered; the discovery call comes before every proposal; the couple
   * signs and pays the retainer in one link. The vendor team is the work
   * itself, so it is always on the job and two of its steps are the
   * journey's. Final details go out three months before (a month-of
   * couple's eight weeks before: planning-scope.ts), are due four weeks out
   * and lock two weeks out, when the final guest count is in. The balance is
   * due thirty days before (Legal Paige).
   */
  planner: {
    delivery: false,
    album: false,
    shotList: false,
    clientDayBefore: true,
    consultation: true,
    trial: false,
    trialMinutes: null,
    walkthroughMinutes: 60,
    perPersonPricing: false,
    extensions: false,
    chairSchedule: false,
    musicPlanner: false,
    planning: { formAtBooking: false, lockDaysBefore: 14, formMonthsBefore: 3, formSend: "auto", finalCall: false },
    balanceDueDaysBefore: 30,
    journey: {
      ...LIGHT_JOURNEY,
      callRequired: true,
      // The final details are their own step; the master timeline is part of
      // "Vendors confirmed", not drawn from one form.
      oneForm: false,
      readiness: "planner",
      vendorSteps: true,
      walkthrough: true,
    },
    coverageRoles: ["coordinator"],
    planningScope: true,
    vendorTeam: "default",
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
 * Whether this trade may go to `target` at all. Adding moves was not enough:
 * a makeup job could still be moved from the day into post-production, and
 * from there a gallery released and its emails sent (2026-10-09).
 */
export function tradeAllows(trade: unknown, target: string): boolean {
  return tradeProfile(trade).delivery || !["POST_PRODUCTION", "DELIVERED"].includes(target);
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
  // Live since the planner's launch (docs/planner-journey-plan.md, Phase 5).
  planner: ["planner"],
  florist: [],
  caterer: [],
  transportation: [],
  other: [],
};

/** Whether a vendor of this type has a live trade to be invited to. */
export function vendorTypeIsLive(type: unknown): boolean {
  return vendorTypeLiveTrades(type).length > 0;
}

/**
 * The live trades a vendor of this type would sign up as, in order: one for a
 * DJ, two for a "hair_makeup" vendor (who picks at signup), none for a florist.
 */
export function vendorTypeLiveTrades(type: unknown): readonly Trade[] {
  return (VENDOR_TYPE_TRADES[String(type ?? "")] ?? []).filter((trade) => LIVE_TRADES.includes(trade));
}
