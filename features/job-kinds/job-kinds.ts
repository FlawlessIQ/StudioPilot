/**
 * Kinds of job — one journey, many kinds of work.
 *
 * docs/job-types-plan-2026-10-02.md. A studio that shoots weddings, family
 * sessions, corporate events and sports runs every one through the same
 * StudioCue journey. The kind of job decides only four things: the words, which
 * steps apply, their timings, and the starter content. Screens never branch on
 * the kind (`if (kind === "wedding")`); they look it up here — `vocab(kind)`,
 * `journeyProfile(kind)` — so everything wedding-only lives in the wedding row
 * of these tables.
 *
 * Stored values are the inquiry form's kinds (inquiry-form-config.ts), so no
 * data migrates: `general` is an inquiry-only kind and never names a job.
 *
 * functions/src/job-kinds/job-kinds.ts mirrors everything below the marker;
 * tests/job-kinds.test.ts compares the two. No imports, so the mirror needs
 * none either.
 */
// ── mirrored below ──

/** The kinds of job the product understands. `general` (an inquiry-only kind) is not one. */
export const JOB_KINDS = ["wedding", "mitzvah", "portraits", "corporate", "sports", "other"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/**
 * What a record from before jobs had kinds reads as, where its words were
 * the wedding's: an old inquiry link, a day-before email, a journey with no
 * profile. Not `jobKindOf`'s fallback, which is "other" — this is only for
 * copy that has always read as a wedding.
 */
export const BEFORE_KINDS: JobKind = "wedding";

/** How a kind is named to the studio — in pickers, settings and filters. */
export const JOB_KIND_LABELS: Record<JobKind, string> = {
  wedding: "Wedding",
  mitzvah: "Bar & bat mitzvah",
  portraits: "Family & portraits",
  corporate: "Corporate & events",
  sports: "Sports",
  other: "Other event",
};

const kindText = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export function isJobKind(value: unknown): value is JobKind {
  return (JOB_KINDS as readonly string[]).includes(kindText(value));
}

/**
 * The kind a free-text type name most likely means. For records written
 * before jobs carried a kind, and for labels a studio typed itself.
 */
export function jobKindFromLabel(label: unknown): JobKind | null {
  const value = kindText(label);
  if (!value) return null;
  // Before the wedding words: a mitzvah has a ceremony too.
  if (/mitzv|\bb'?nai\b|\bb'?not\b|\bbimah\b/.test(value)) return "mitzvah";
  if (/wedding|elop|marriage|ceremony|engagement|bridal/.test(value)) return "wedding";
  if (/headshot|corporate|conference|company|business|gala|summit|brand|commercial|staff/.test(value)) return "corporate";
  if (/sport|cheer|game|team|tournament|league|athlet|match|meet\b|race/.test(value)) return "sports";
  if (/family|portrait|newborn|maternity|senior|session|kids|child|baby|pet|mini/.test(value)) return "portraits";
  return null;
}

/**
 * What kind of job a record is: a project, a lead, a package.
 *
 * `eventKind` decides when it is set — every path that makes a job writes it
 * (Phase 0). Older records fall back to `eventTypeId`, then the label. Unknown
 * is "other", **never "wedding"**: a family reading "your wedding" is the
 * embarrassing failure, and a wedding reading "your event" is merely plain.
 */
export function jobKindOf(source: unknown): JobKind {
  if (!source || typeof source !== "object") return "other";
  const record = source as {
    eventKind?: unknown;
    eventTypeId?: unknown;
    eventType?: unknown;
    eventTypeLabel?: unknown;
  };
  const kind = kindText(record.eventKind);
  if (kind === "general") return "other";
  if (isJobKind(kind)) return kind as JobKind;
  const id = kindText(record.eventTypeId);
  if (isJobKind(id)) return id as JobKind;
  // The retired eventTypeTemplates taxonomy.
  if (id === "school") return "portraits";
  if (id === "business") return "corporate";
  return (
    jobKindFromLabel(record.eventType) ??
    jobKindFromLabel(record.eventTypeLabel) ??
    jobKindFromLabel(record.eventTypeId) ??
    "other"
  );
}

// ── Words ────────────────────────────────────────────────────────────────

export type JobVocabulary = {
  /** "wedding", "session", "event" — mid-sentence. */
  event: string;
  /** "Wedding", "Session", "Event" — at the start of a line. */
  Event: string;
  /** "your wedding", "your session". */
  yourEvent: string;
  /** "Your wedding", "Your session". */
  YourEvent: string;
  /** "the day", "session day", "game day". */
  theDay: string;
  /** "Wedding day", "Session day", "Game day" — a heading. */
  Day: string;
  /** Who the client is when there is no name to use. Prefer clientRef(). */
  clientFallback: string;
  /** The planning questionnaire's default name. */
  detailsForm: string;
  /** The run of show. */
  schedule: string;
  /** The crew and studio's one-page brief. */
  brief: string;
  /** The agreement's event-details schedule. */
  scheduleA: string;
  /** The delivery stage, to the client. */
  afterwards: string;
  /** What the day-before email reminds the client to have ready. */
  dayBeforeChecklist: string[];
  /** The day-before step's line on the journey, before it goes. */
  dayBeforeLine: string;
  /**
   * The day-before email, when the kind has a letter of its own (a wedding's
   * dress on its hanger, word for word as the journey film shows it). Null
   * sends the kind's checklist in the plain letter.
   */
  dayBeforeLetter: {
    excited: string;
    ask: string;
    items: readonly string[];
    highlights: readonly [string, string];
  } | null;
  /** A photographer's prep sentence in the week-of email; null lists the checklist. */
  prepSentence: string | null;
  /** The planning-form step's line on the journey, before it's filled in. */
  formAsks: string;
  /** The month-out schedule email's "has anything changed?" line. */
  timesChanged: string;
  /** What a photographer's final-details email says it holds. */
  finalDetailsHolds: string;
  /** What a DJ's final-details email calls the event: "your night". */
  musicOccasion: string;
  /** About their event, on the inquiry link and page: "your day". */
  aboutYours: string;
  /** The inquiry page's question when it asks for the date. */
  whenQuestion: string;
  /** The inquiry page's label for the date; null keeps the field's own. */
  dateAsk: string | null;
  /** A new inquiry, to the studio, when there is no name. */
  newClient: string;
  /** The client, to the studio, when there is no name. */
  yourClient: string;
  /** Clients like this one, to the studio: "Couples often write to several…". */
  Clients: string;
  /** Who else a review helps: "other couples". */
  othersLikeYou: string;
  /** A typical day, as the day-plan builder says it. */
  typicalDay: string;
  /** The inquiry form's step about the day. */
  inquiryDayTitle: string;
  /** A vendor's timeline names the occasion by the client: "Emma & James's wedding". */
  occasionByName: boolean;
};

/** The words every kind but a wedding shares. */
const PLAIN_WORDS = {
  dayBeforeLetter: null,
  prepSentence: null,
  formAsks: "Locations, times, and anything to know",
  timesChanged: "If any times or places have changed at all, just reply and we'll update the plan.",
  finalDetailsHolds: "every location and time, and the timeline",
  musicOccasion: "event",
  whenQuestion: "when’s the day?",
  dateAsk: "The date you have in mind",
  newClient: "A new client",
  yourClient: "Your client",
  Clients: "People",
  othersLikeYou: "others",
  typicalDay: "day",
  inquiryDayTitle: "When and where?",
  occasionByName: false,
} as const;

const VOCAB: Record<JobKind, JobVocabulary> = {
  wedding: {
    event: "wedding",
    Event: "Wedding",
    yourEvent: "your wedding",
    YourEvent: "Your wedding",
    theDay: "the day",
    Day: "Wedding day",
    clientFallback: "the couple",
    detailsForm: "Wedding details",
    schedule: "Wedding-day timeline",
    brief: "Wedding brief",
    scheduleA: "Wedding details (Schedule A)",
    afterwards: "After the wedding",
    dayBeforeChecklist: [
      "the dress on a hanger, ready to photograph",
      "rings, flowers and invitations in one place",
      "a family photo list to whoever is gathering people",
    ],
    dayBeforeLine: "Dress, shoes, flowers, rings, invitations ready",
    dayBeforeLetter: {
      excited: "It's going to be the best day.",
      ask: "One small ask that saves us all 20 minutes in the morning — please have these ready when we arrive:",
      items: ["Dress on its special hanger", "Shoes, flowers, and rings together", "Invitations and any keepsake details"],
      highlights: ["Day-before detail checklist", "Saves ~20 minutes on site"],
    },
    prepSentence:
      "To help photography begin on time, please have the wedding dress on a hanger and keep the shoes, flowers, rings, and invitation suite together before we arrive.",
    formAsks: "Prep locations, times, and family names",
    timesChanged: "If ceremony, reception, or prep times have changed at all, just reply and we'll update the plan.",
    finalDetailsHolds: "where you're getting ready, the ceremony and reception, any photo stops, and the timeline",
    musicOccasion: "night",
    aboutYours: "your day",
    whenQuestion: "when’s the wedding?",
    dateAsk: null,
    newClient: "A new couple",
    yourClient: "Your couple",
    Clients: "Couples",
    othersLikeYou: "other couples",
    typicalDay: "wedding day",
    inquiryDayTitle: "Tell us about your day",
    occasionByName: true,
  },
  // docs/mitzvah-journey-plan-2026-10-14.md. The client is the parents; the
  // honoree is their child, named by vocab(kind, job) when the job knows them.
  mitzvah: {
    event: "mitzvah",
    Event: "Mitzvah",
    yourEvent: "your celebration",
    YourEvent: "Your celebration",
    theDay: "the day",
    Day: "Mitzvah day",
    clientFallback: "the family",
    detailsForm: "Mitzvah details",
    schedule: "Mitzvah run of show",
    brief: "Mitzvah brief",
    scheduleA: "Mitzvah details (Schedule A)",
    afterwards: "After the celebration",
    dayBeforeChecklist: [
      "the candle-lighting list, final and in order",
      "the tallit, kippot and anything for the portraits",
      "the montage file sent to the DJ",
    ],
    ...PLAIN_WORDS,
    dayBeforeLine: "The candle-lighting list, final and in order",
    formAsks: "The service, the party, and who lights the candles",
    timesChanged: "If the service, party, or portrait times have changed at all, just reply and we'll update the plan.",
    finalDetailsHolds: "the service and the party, the portrait session, and the timeline",
    musicOccasion: "party",
    aboutYours: "your celebration",
    whenQuestion: "when’s the celebration?",
    dateAsk: "The date of the party",
    newClient: "A new family",
    othersLikeYou: "other families",
    Clients: "Families",
    typicalDay: "mitzvah day",
    inquiryDayTitle: "Tell us about the celebration",
  },
  portraits: {
    event: "session",
    Event: "Session",
    yourEvent: "your session",
    YourEvent: "Your session",
    theDay: "session day",
    Day: "Session day",
    clientFallback: "the family",
    detailsForm: "Session details",
    schedule: "Session plan",
    brief: "Session brief",
    scheduleA: "Session details (Schedule A)",
    afterwards: "After your session",
    dayBeforeChecklist: [
      "outfits laid out, colors that sit well together",
      "little ones fed and rested before we start",
      "any props or favorite toys you want in the photos",
    ],
    ...PLAIN_WORDS,
    dayBeforeLine: "Outfits laid out, colors that sit well together",
    aboutYours: "your session",
  },
  corporate: {
    event: "event",
    Event: "Event",
    yourEvent: "your event",
    YourEvent: "Your event",
    theDay: "event day",
    Day: "Event day",
    clientFallback: "the client",
    detailsForm: "Event details",
    schedule: "Run of show",
    brief: "Event brief",
    scheduleA: "Event details (Schedule A)",
    afterwards: "After the event",
    dayBeforeChecklist: [
      "the on-site contact's name and number",
      "parking and load-in details",
      "badges, the agenda and the shot list of people who matter",
    ],
    ...PLAIN_WORDS,
    dayBeforeLine: "The on-site contact's name and number",
    aboutYours: "your event",
  },
  sports: {
    event: "event",
    Event: "Event",
    yourEvent: "your event",
    YourEvent: "Your event",
    theDay: "game day",
    Day: "Game day",
    clientFallback: "the team",
    detailsForm: "Event details",
    schedule: "Game-day plan",
    brief: "Event brief",
    scheduleA: "Event details (Schedule A)",
    afterwards: "After the event",
    dayBeforeChecklist: [
      "uniforms and kit ready",
      "the roster, with names as they should be spelled",
      "the arrival time and where we meet",
    ],
    ...PLAIN_WORDS,
    dayBeforeLine: "Uniforms and kit ready",
    aboutYours: "your event",
  },
  other: {
    event: "event",
    Event: "Event",
    yourEvent: "your event",
    YourEvent: "Your event",
    theDay: "the day",
    Day: "Event day",
    clientFallback: "the client",
    detailsForm: "Event details",
    schedule: "Run of show",
    brief: "Event brief",
    scheduleA: "Event details (Schedule A)",
    afterwards: "After the event",
    dayBeforeChecklist: [
      "the on-site contact's name and number",
      "the timings for the day",
    ],
    ...PLAIN_WORDS,
    dayBeforeLine: "The on-site contact's name and number",
    aboutYours: "your event",
  },
};

// ── Mitzvahs ─────────────────────────────────────────────────────────────

/**
 * Which mitzvah a job is: bar (a boy), bat (a girl), b'nai (twins or
 * siblings, or a mixed group), b'not (girls together). Stored on the job as
 * `mitzvahType`, with the child's first name as `honoreeName`; the parents
 * stay the client and the contact.
 */
export const MITZVAH_TYPES = ["bar", "bat", "bnai", "bnot"] as const;
export type MitzvahType = (typeof MITZVAH_TYPES)[number];

export const MITZVAH_TYPE_LABELS: Record<MitzvahType, string> = {
  bar: "Bar mitzvah",
  bat: "Bat mitzvah",
  bnai: "B'nai mitzvah",
  bnot: "B'not mitzvah",
};

export function isMitzvahType(value: unknown): value is MitzvahType {
  return (MITZVAH_TYPES as readonly string[]).includes(kindText(value));
}

/** The mitzvah a label names: "Bat Mitzvah" is bat. Null when it doesn't say. */
export function mitzvahTypeFromLabel(label: unknown): MitzvahType | null {
  const value = kindText(label);
  if (/\bbar[\s-]*mitzv/.test(value)) return "bar";
  if (/\bbat[\s-]*mitzv/.test(value)) return "bat";
  if (/\bb'?nai\b/.test(value)) return "bnai";
  if (/\bb'?not\b/.test(value)) return "bnot";
  return null;
}

/** A job's mitzvah, from its own fields, then its type's label. */
export function mitzvahOf(job: unknown): { type: MitzvahType | null; honoree: string | null } {
  const record = (job && typeof job === "object" ? job : {}) as {
    mitzvahType?: unknown;
    honoreeName?: unknown;
    eventType?: unknown;
    eventTypeLabel?: unknown;
  };
  const type = isMitzvahType(record.mitzvahType)
    ? (kindText(record.mitzvahType) as MitzvahType)
    : (mitzvahTypeFromLabel(record.eventTypeLabel) ?? mitzvahTypeFromLabel(record.eventType));
  const honoree = typeof record.honoreeName === "string" ? record.honoreeName.trim().slice(0, 80) : "";
  return { type, honoree: honoree || null };
}

const capitalize = (value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

/**
 * A mitzvah's words for one job: "bat mitzvah", "Sam's bat mitzvah". Without
 * a type it stays "mitzvah" and "your celebration".
 */
function mitzvahWords(base: JobVocabulary, job: unknown): JobVocabulary {
  const { type, honoree } = mitzvahOf(job);
  if (!type) return base;
  const event = MITZVAH_TYPE_LABELS[type].toLowerCase();
  const yours = honoree ? `${honoree}'s ${event}` : `the ${event}`;
  return {
    ...base,
    event,
    Event: capitalize(event),
    yourEvent: yours,
    YourEvent: capitalize(yours),
    aboutYours: yours,
  };
}

/**
 * The words for a kind of job. Pass the job as well where it is at hand: a
 * mitzvah then names itself ("Sam's bar mitzvah").
 */
export function vocab(kind: unknown, job?: unknown): JobVocabulary {
  if (job !== undefined && isJobKind(kind) && kindText(kind) === "mitzvah") return mitzvahWords(vocabFor(kind), job);
  return vocabFor(kind);
}

function vocabFor(kind: unknown): JobVocabulary {
  return VOCAB[isJobKind(kind) ? (kindText(kind) as JobKind) : "other"];
}

/**
 * Who the client is, by name when there is one. "Emma & James" or "Acme
 * Corp" beats any noun, and dodges "the couple are" / "the client is".
 */
export function clientRef(name: unknown, kind: JobKind | null | undefined): string {
  const value = typeof name === "string" ? name.trim() : "";
  return value || vocab(kind).clientFallback;
}

// ── Steps, timings and the booking gate ──────────────────────────────────

/**
 * How a job is paid for.
 * - `deposit_and_balance`: a retainer to book, the rest before the day (weddings).
 * - `paid_in_full`: the whole price to book (family sessions).
 * - `on_the_day`: nothing to book; the full invoice is due on the event date (sports).
 * - `invoice_after`: nothing to book; invoiced after the event (some corporate work).
 */
export const PAYMENT_SHAPES = ["deposit_and_balance", "paid_in_full", "on_the_day", "invoice_after"] as const;
export type PaymentShape = (typeof PAYMENT_SHAPES)[number];

export const PAYMENT_SHAPE_LABELS: Record<PaymentShape, string> = {
  deposit_and_balance: "Deposit to book, balance before the day",
  paid_in_full: "Paid in full to book",
  on_the_day: "Paid on the day",
  invoice_after: "Invoiced after the event",
};

/**
 * A shape's label for this studio. A makeup artist or hair stylist collects
 * the balance on the day itself (trades.ts `journey.balanceOnTheDay`, passed
 * in, since this file imports nothing): "before the day" told Jess Styles
 * Bridal the opposite of how she is paid (2026-10-10). Every other studio
 * reads PAYMENT_SHAPE_LABELS as written.
 */
export function paymentShapeLabel(shape: PaymentShape, balanceOnTheDay = false): string {
  return shape === "deposit_and_balance" && balanceOnTheDay
    ? "Deposit to book, balance on the day"
    : PAYMENT_SHAPE_LABELS[shape];
}

export function isPaymentShape(value: unknown): value is PaymentShape {
  return (PAYMENT_SHAPES as readonly string[]).includes(String(value ?? ""));
}

export type JourneyProfile = {
  kind: JobKind;
  /** Offer a consultation call. */
  consultation: boolean;
  /** An agreement is part of booking. */
  agreement: boolean;
  payment: PaymentShape;
  /** Days before the event the details form is sent; null never. */
  detailsFormDaysBefore: number | null;
  /** The final-details lock and sign-off before the day. */
  finalDetailsLock: boolean;
  /** StudioCue drafts a run of show. */
  runOfShow: boolean;
  /** Crew are staffed by default. */
  crew: boolean;
  /** A certificate of insurance can be asked for. */
  coi: boolean;
  /** Ask the client for a billing address when invoicing needs one. */
  billingAddressRequest: boolean;
  /** An album can be part of the package. */
  album: boolean;
  /** One booking per date: a second inquiry for the day is a clash. */
  exclusiveDay: boolean;
  /**
   * The studio's planning timeline (planning-timeline.ts) runs this kind's
   * details form: the date it goes out, the form the studio chose, and the
   * form at booking. Other kinds count back `detailsFormDaysBefore` with
   * their own form.
   */
  planningTimeline: boolean;
  /** The shot list goes with the planning form, and the client can upload must-take photos. */
  shotList: boolean;
  /** The client is asked for the rest of their vendor team. */
  vendorTeam: boolean;
  /**
   * The day plan StudioCue lays out from the form's answers alone, with no
   * AI and no timing rules (features/schedules/day-plan.ts). Null: an AI
   * draft from the kind's usual moments.
   */
  dayPlan: "wedding" | "mitzvah" | null;
  /** The client is two people: the inquiry asks for a partner and the ceremony time. */
  partner: boolean;
  /**
   * Whose parts Schedule A insists on from booking (event-details.ts): a
   * wedding's getting ready, ceremony, reception and times; a mitzvah's
   * service, party and times. Null: none required.
   */
  scheduleAParts: "wedding" | "mitzvah" | null;
  /**
   * The job celebrates someone who isn't the client: a mitzvah's child. It
   * carries their first name (`honoreeName`) and which mitzvah it is
   * (`mitzvahType`); the parents stay the client and the contact.
   */
  honoree: boolean;
};

/** The steps every kind but a wedding leaves out. */
const PLAIN_STEPS = {
  planningTimeline: false,
  shotList: false,
  vendorTeam: false,
  dayPlan: null,
  partner: false,
  scheduleAParts: null,
  honoree: false,
} as const;

const PROFILES: Record<JobKind, Omit<JourneyProfile, "kind">> = {
  wedding: {
    consultation: true,
    agreement: true,
    payment: "deposit_and_balance",
    detailsFormDaysBefore: 180,
    finalDetailsLock: true,
    runOfShow: true,
    crew: true,
    coi: true,
    billingAddressRequest: true,
    album: true,
    exclusiveDay: true,
    planningTimeline: true,
    shotList: true,
    vendorTeam: true,
    dayPlan: "wedding",
    partner: true,
    scheduleAParts: "wedding",
    honoree: false,
  },
  // The wedding's weight (docs/mitzvah-journey-plan-2026-10-14.md): a call,
  // an agreement, a deposit and a balance, a run of show, crew and an album.
  // Families book 9–18 months out; the details form goes 90 days before.
  // The wedding-only steps stay off until their mitzvah content exists
  // (Phases 3–4): the shot list, the vendor-team ask, the built day plan.
  mitzvah: {
    consultation: true,
    agreement: true,
    payment: "deposit_and_balance",
    detailsFormDaysBefore: 90,
    finalDetailsLock: true,
    runOfShow: true,
    crew: true,
    coi: true,
    billingAddressRequest: true,
    album: true,
    exclusiveDay: true,
    ...PLAIN_STEPS,
    // Phase 3: the photographer's mitzvah forms, day plan and Schedule A.
    shotList: true,
    dayPlan: "mitzvah",
    scheduleAParts: "mitzvah",
    honoree: true,
  },
  // Gabe, 2026-10-02: no agreement ("that's overkill"), paid in full.
  portraits: {
    consultation: false,
    agreement: false,
    payment: "paid_in_full",
    detailsFormDaysBefore: 14,
    finalDetailsLock: false,
    runOfShow: false,
    crew: false,
    coi: false,
    billingAddressRequest: false,
    album: true,
    exclusiveDay: false,
    ...PLAIN_STEPS,
  },
  // Gabe: both deposit + balance and invoice-after happen; the package decides.
  corporate: {
    consultation: true,
    agreement: true,
    payment: "deposit_and_balance",
    detailsFormDaysBefore: 28,
    finalDetailsLock: false,
    runOfShow: true,
    crew: true,
    coi: true,
    billingAddressRequest: true,
    album: false,
    exclusiveDay: true,
    ...PLAIN_STEPS,
  },
  // Gabe: no agreement, paid on the day.
  sports: {
    consultation: false,
    agreement: false,
    payment: "on_the_day",
    detailsFormDaysBefore: 14,
    finalDetailsLock: false,
    runOfShow: true,
    crew: true,
    coi: true,
    billingAddressRequest: false,
    album: false,
    exclusiveDay: false,
    ...PLAIN_STEPS,
  },
  other: {
    consultation: true,
    agreement: true,
    payment: "deposit_and_balance",
    detailsFormDaysBefore: 28,
    finalDetailsLock: false,
    runOfShow: true,
    crew: true,
    coi: true,
    billingAddressRequest: true,
    album: false,
    exclusiveDay: true,
    ...PLAIN_STEPS,
  },
};

/**
 * Which steps a job has, and when. A package's payment shape, when it has
 * one, overrides the kind's default — corporate work is booked both ways.
 * `detailsFormDaysBefore` for weddings is the studio's planning timeline when
 * it has set one.
 */
export function journeyProfile(
  // A JobKind; anything else (an inquiry's "general", nothing) is "other".
  kind: unknown,
  overrides: { payment?: unknown; detailsFormDaysBefore?: unknown } = {},
): JourneyProfile {
  const resolved: JobKind = isJobKind(kind) ? (kindText(kind) as JobKind) : "other";
  const base = PROFILES[resolved];
  const days = Number(overrides.detailsFormDaysBefore);
  return {
    kind: resolved,
    ...base,
    payment: isPaymentShape(overrides.payment) ? overrides.payment : base.payment,
    detailsFormDaysBefore:
      base.detailsFormDaysBefore !== null && Number.isFinite(days) && days > 0
        ? Math.round(days)
        : base.detailsFormDaysBefore,
  };
}

/**
 * What the booking gate asks of a job of this profile.
 * - `agreement`: a completed (or hand-attested) agreement.
 * - `payment`: the retainer — the deposit, or the whole price when paid in full.
 *   False when nothing is paid to book (on the day, invoiced after).
 */
export function bookingGateNeeds(profile: Pick<JourneyProfile, "agreement" | "payment">): {
  agreement: boolean;
  payment: boolean;
} {
  return {
    agreement: profile.agreement,
    payment: profile.payment === "deposit_and_balance" || profile.payment === "paid_in_full",
  };
}

/** Whether a final-balance invoice follows the booking. */
export function hasFinalBalance(profile: Pick<JourneyProfile, "payment">): boolean {
  return profile.payment === "deposit_and_balance";
}

/**
 * A job's profile, from the job itself: its kind, and the payment shape its
 * package carried onto it (`paymentShape`, written when the package is
 * chosen). What the booking gate, the schedulers and the journey all read.
 */
export function projectProfile(project: unknown): JourneyProfile {
  const record = (project && typeof project === "object" ? project : {}) as { paymentShape?: unknown };
  return journeyProfile(jobKindOf(project), { payment: record.paymentShape });
}

/**
 * The light-journey switches a trade carries (features/trades/trades.ts
 * `TradeJourney`), restated here so this module keeps no imports.
 */
export type TradeJourneyShape = {
  consultation: boolean;
  journey: {
    callRequired: boolean;
    oneLinkBooking: boolean;
    insuranceByDefault: boolean;
    crewByDefault: boolean;
    scheduleApproval: boolean;
    oneForm: boolean;
    balanceOnTheDay: boolean;
    reviewAfterDay: boolean;
    readiness: "full" | "essentials" | "planner";
    foldRoutine: boolean;
  };
};

/** What the light-journey switches add to a kind's profile. */
export type JourneyExtras = {
  /** The quote waits for the call. False when there is no call, or it is optional (a DJ's vibe call). */
  callRequired: boolean;
  /** Sign and pay the deposit in one link. */
  oneLinkBooking: boolean;
  /** The client approves the day's schedule. */
  scheduleApproval: boolean;
  /** One planning form, and the day's plan drawn from it. */
  oneForm: boolean;
  /** The balance is collected on the day. */
  balanceOnTheDay: boolean;
  /** Review asks follow the day, not a delivery. */
  reviewAfterDay: boolean;
  /** Which readiness checks the job carries. */
  readiness: "full" | "essentials" | "planner";
  /** The first reply, the day-before note and the kit fold into the steps beside them. */
  foldRoutine: boolean;
};

export type JobJourney = JourneyProfile & JourneyExtras;

/** The parts of a kind's profile the trade lightens. */
type JourneyCore = Pick<JourneyProfile, "consultation" | "agreement" | "payment" | "runOfShow" | "crew" | "coi">;

/**
 * One profile for a job: what its kind needs, lightened by its studio's trade.
 *
 * Every gate used to AND the two itself ("a family session has no call", "a
 * makeup artist has no call"), and every gate written later had to remember
 * to. Now the journey, the portal, the checks and the server read this
 * (simpler vendor journeys, 2026-10-09). Pass `tradeProfile(trade)`; a job's
 * own facts switch a default back on — a venue that asked for insurance.
 */
export function journeyFor<P extends JourneyCore>(
  profile: P,
  trade: TradeJourneyShape,
  job: { insuranceRequired?: unknown } = {},
): P & JourneyExtras {
  const light = trade.journey;
  const consultation = profile.consultation && trade.consultation;
  return {
    ...profile,
    consultation,
    callRequired: consultation && light.callRequired,
    coi: profile.coi && (light.insuranceByDefault || job.insuranceRequired === "required"),
    crew: profile.crew && light.crewByDefault,
    oneLinkBooking: profile.agreement && light.oneLinkBooking,
    scheduleApproval: profile.runOfShow && light.scheduleApproval,
    oneForm: light.oneForm,
    balanceOnTheDay: profile.payment === "deposit_and_balance" && light.balanceOnTheDay,
    reviewAfterDay: light.reviewAfterDay,
    readiness: light.readiness,
    foldRoutine: light.foldRoutine,
  };
}

/** What booking this job needs — the booking gate's `needs` (gate-requirements.ts). */
export function projectGateNeeds(project: unknown): {
  agreement: boolean;
  payment: boolean;
  exclusiveDay: boolean;
} {
  const profile = projectProfile(project);
  return { ...bookingGateNeeds(profile), exclusiveDay: profile.exclusiveDay };
}

/**
 * The day a job's details form goes out. A kind on the studio's planning
 * timeline (a wedding) follows it (passed in — planning-timeline.ts counts it
 * in months); every other kind counts back its profile's days. Null for an undated job
 * or a kind that sends no details form.
 */
export function detailsFormOpensOn(
  project: unknown,
  eventDate: string | null | undefined,
  timelineOpensOn: string | null,
): string | null {
  const profile = projectProfile(project);
  if (profile.detailsFormDaysBefore === null) return null;
  if (profile.planningTimeline) return timelineOpensOn;
  const day = String(eventDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() - profile.detailsFormDaysBefore);
  return value.toISOString().slice(0, 10);
}

/** Whether the final details lock (and the sign-off before it) apply to this job. */
export function finalDetailsLockApplies(project: unknown): boolean {
  return projectProfile(project).finalDetailsLock;
}

/**
 * Whether a job's date clashes with jobs already on that day.
 *
 * One booking per day was the rule for everything, which is right for a
 * wedding and wrong for family sessions — several fit in a day. So a day is
 * taken when either side is a whole-day kind (`exclusiveDay`): a wedding
 * blocks the sessions, a session doesn't block another session. `others` are
 * the jobs already holding the date (booked, not archived), the caller's
 * filter.
 */
export function dateClashes(project: unknown, others: readonly unknown[]): boolean {
  const exclusive = projectProfile(project).exclusiveDay;
  return others.some((other) => exclusive || projectProfile(other).exclusiveDay);
}

const ON_THE_DAY_STATES = ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE"];
const AFTER_EVENT_STATES = ["EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"];

function shiftDay(day: string, days: number): string {
  const value = new Date(`${day}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * When a job that booked with nothing paid gets its one bill, and when it is
 * due — or null when today isn't that time (or the job bills another way).
 *
 * - **Paid on the day** (sports): from a fortnight before, due on the day. A
 *   "Take payment" on the day settles it, or the client pays the link.
 * - **Invoiced after** (some corporate work): once the job is shot, due in
 *   thirty days.
 *
 * Offered to the studio on Today, never raised by the scheduler: no customer
 * exists for these jobs yet, and nothing new is billed without someone
 * choosing to (final-balance billing, 2026-09-30).
 */
export function singleBillWindow(project: unknown, today: string): { dueDate: string } | null {
  const fields = (project ?? {}) as { state?: unknown; eventDate?: unknown };
  const eventDate = String(fields.eventDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const state = String(fields.state ?? "");
  const payment = projectProfile(project).payment;
  if (payment === "on_the_day") {
    if (!ON_THE_DAY_STATES.includes(state) || eventDate > shiftDay(today, 14)) return null;
  } else if (payment === "invoice_after") {
    if (!AFTER_EVENT_STATES.includes(state) || eventDate > today) return null;
  } else return null;
  return { dueDate: singleBillDueDate(project) ?? eventDate };
}

/** When a job's one bill is due: the day itself, or thirty days after it. Null for a deposit or paid-in-full job. */
export function singleBillDueDate(project: unknown): string | null {
  const eventDate = String(((project ?? {}) as { eventDate?: unknown }).eventDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return null;
  const payment = projectProfile(project).payment;
  if (payment === "on_the_day") return eventDate;
  if (payment === "invoice_after") return shiftDay(eventDate, 30);
  return null;
}

/**
 * What books a job of this profile, as a clause: "the agreement is signed and
 * the retainer is paid". One sentence for the Booking tab, Cue's card and the
 * help, so none of them tells a family-session studio about a contract.
 */
export function bookedOnceClause(
  profile: Pick<JourneyProfile, "agreement" | "payment">,
  // The trade's word (trades.ts `deposit`): a vendor's client pays a deposit.
  deposit = "retainer",
): string {
  const needs = bookingGateNeeds(profile);
  const payment =
    profile.payment === "paid_in_full" ? "it's paid in full" : needs.payment ? `the ${deposit} is paid` : null;
  if (needs.agreement && payment) return `the agreement is signed and ${payment}`;
  if (needs.agreement) return "the agreement is signed";
  if (payment) return payment;
  return "the date and client details check out";
}

/**
 * The payment lines a proposal carries, by how the job is paid.
 *
 * The walk of 2026-10-03 sent a family a proposal reading "Retainer $135,
 * final balance $315 due Sep 26" for a $450 session paid in full — while the
 * invoice StudioCue raised was $450. Every reader takes its figure from these
 * lines (agreed-retainer.ts, agreed-final-balance.ts), so writing them by the
 * job's payment shape makes the proposal, the booking screen, the hand-payment
 * form and the invoice say the same number.
 *
 * - Deposit and balance: "Retainer" then "Final balance" (unchanged).
 * - Paid in full: one "Payment in full" line for the whole price, due to book.
 * - On the day: one "Payment on the day" line, due on the event date.
 * - Invoiced after: one "Invoice after the event" line, due thirty days after.
 */
export const SCHEDULE_LABELS = {
  retainer: "Retainer",
  finalBalance: "Final balance",
  paidInFull: "Payment in full",
  onTheDay: "Payment on the day",
  invoiceAfter: "Invoice after the event",
} as const;

export type ScheduleLine = { label: string; amountCents: number; dueDate: string | null };

export function paymentScheduleFor(
  payment: PaymentShape,
  input: {
    totalCents: number;
    retainerCents: number;
    retainerDueDate: string | null;
    balanceDueDate: string | null;
    eventDate: string | null | undefined;
  },
): ScheduleLine[] {
  const total = Math.max(0, Math.round(Number(input.totalCents) || 0));
  const day = String(input.eventDate ?? "").slice(0, 10);
  const eventDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  if (payment === "paid_in_full") {
    return [{ label: SCHEDULE_LABELS.paidInFull, amountCents: total, dueDate: input.retainerDueDate }];
  }
  if (payment === "on_the_day") {
    return [{ label: SCHEDULE_LABELS.onTheDay, amountCents: total, dueDate: eventDay }];
  }
  if (payment === "invoice_after") {
    return [{ label: SCHEDULE_LABELS.invoiceAfter, amountCents: total, dueDate: eventDay ? shiftDay(eventDay, 30) : null }];
  }
  const retainer = Math.min(Math.max(0, Math.round(Number(input.retainerCents) || 0)), total);
  return [
    { label: SCHEDULE_LABELS.retainer, amountCents: retainer, dueDate: input.retainerDueDate },
    { label: SCHEDULE_LABELS.finalBalance, amountCents: total - retainer, dueDate: input.balanceDueDate },
  ];
}
