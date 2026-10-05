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
};

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

/**
 * A job's profile, from the job itself: its kind, and the payment shape its
 * package carried onto it (`paymentShape`, written when the package is
 * chosen). What the booking gate, the schedulers and the journey all read.
 */
export function projectProfile(project: unknown): JourneyProfile {
  const record = (project && typeof project === "object" ? project : {}) as { paymentShape?: unknown };
  return journeyProfile(jobKindOf(project), { payment: record.paymentShape });
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
 * The day a job's details form goes out. Weddings follow the studio's
 * planning timeline (passed in — planning-timeline.ts counts it in months);
 * every other kind counts back its profile's days. Null for an undated job
 * or a kind that sends no details form.
 */
export function detailsFormOpensOn(
  project: unknown,
  eventDate: string | null | undefined,
  weddingOpensOn: string | null,
): string | null {
  const profile = projectProfile(project);
  if (profile.detailsFormDaysBefore === null) return null;
  if (profile.kind === "wedding") return weddingOpensOn;
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
export function bookedOnceClause(profile: Pick<JourneyProfile, "agreement" | "payment">): string {
  const needs = bookingGateNeeds(profile);
  const payment =
    profile.payment === "paid_in_full" ? "it's paid in full" : needs.payment ? "the retainer is paid" : null;
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
