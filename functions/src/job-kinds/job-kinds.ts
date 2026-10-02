/**
 * Kinds of job — the functions copy of features/job-kinds/job-kinds.ts, which
 * explains the design (docs/job-types-plan-2026-10-02.md). functions/ cannot
 * import from features/, so everything below the marker is kept identical and
 * tests/job-kinds.test.ts compares the two.
 */
// ── mirrored below ──

/** The kinds of job the product understands. `general` (an inquiry-only kind) is not one. */
export const JOB_KINDS = ["wedding", "portraits", "corporate", "sports", "other"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** How a kind is named to the studio — in pickers, settings and filters. */
export const JOB_KIND_LABELS: Record<JobKind, string> = {
  wedding: "Wedding",
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
};

const VOCAB: Record<JobKind, JobVocabulary> = {
  wedding: {
    event: "wedding",
    Event: "Wedding",
    yourEvent: "your wedding",
    YourEvent: "Your wedding",
    theDay: "the day",
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
  },
  portraits: {
    event: "session",
    Event: "Session",
    yourEvent: "your session",
    YourEvent: "Your session",
    theDay: "session day",
    clientFallback: "the family",
    detailsForm: "Session details",
    schedule: "Session plan",
    brief: "Session brief",
    scheduleA: "Session details (Schedule A)",
    afterwards: "After your session",
    dayBeforeChecklist: [
      "outfits laid out, colours that sit well together",
      "little ones fed and rested before we start",
      "any props or favourite toys you want in the photos",
    ],
  },
  corporate: {
    event: "event",
    Event: "Event",
    yourEvent: "your event",
    YourEvent: "Your event",
    theDay: "event day",
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
  },
  sports: {
    event: "event",
    Event: "Event",
    yourEvent: "your event",
    YourEvent: "Your event",
    theDay: "game day",
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
  },
  other: {
    event: "event",
    Event: "Event",
    yourEvent: "your event",
    YourEvent: "Your event",
    theDay: "the day",
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
  },
};

/** The words for a kind of job. */
export function vocab(kind: JobKind | null | undefined): JobVocabulary {
  return VOCAB[kind && isJobKind(kind) ? kind : "other"];
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
};

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
  },
};

/**
 * Which steps a job has, and when. A package's payment shape, when it has
 * one, overrides the kind's default — corporate work is booked both ways.
 * `detailsFormDaysBefore` for weddings is the studio's planning timeline when
 * it has set one.
 */
export function journeyProfile(
  kind: JobKind | null | undefined,
  overrides: { payment?: unknown; detailsFormDaysBefore?: unknown } = {},
): JourneyProfile {
  const resolved: JobKind = kind && isJobKind(kind) ? kind : "other";
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
