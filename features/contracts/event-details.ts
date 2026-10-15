/**
 * Schedule A — the wedding (or event) details, in every agreement.
 *
 * GR Productions (2026-10-02): the details belong in the contract, because
 * that is what stops a couple changing things — the photo stop on the way
 * from the church to the hotel, the ceremony time. At booking a couple
 * should have their getting-ready, ceremony and reception locations and the
 * general times; the final details are confirmed four weeks before.
 *
 * Built from the couple's own form answers (the latest returned form on the
 * job, as `form.answers` already is) and the job's records, sorted by what
 * each question asks. Studios write their own questions — "Bride Getting
 * Ready Address", "Ceremony Times", "Where are you getting ready?" — so the
 * sorting reads the wording. A required part nobody has given yet is printed
 * as "To be confirmed" and listed for the studio before the agreement goes.
 *
 * Plain headings, paragraphs and lists — no new block type — so the document
 * format, its schema and the PDF renderer are untouched, and it sits inside
 * the signed document's hash like every other word.
 *
 * Pure. Duplicated at functions/src/contracts/event-details.ts; the test
 * fails on drift.
 */

export type EventDetailRow = { label: string; value: string };

export type EventDetails = {
  /** "Wedding details" or "Event details". */
  title: string;
  rows: EventDetailRow[];
  /** Required parts nobody has given yet: printed "To be confirmed". */
  missing: string[];
  /**
   * Days before the date the final details lock, or null when this kind of
   * job has no lock (job-kinds.ts: only weddings do). Schedule A promises the
   * lock only when there is one — a corporate agreement promised "four weeks
   * before the date" for a process that never runs (walk, 2026-10-03).
   */
  lockDaysBefore: number | null;
  /**
   * A makeup artist's or hair stylist's lock is on the headcount: after it,
   * people can be added but not taken off (docs/vendor-journeys.md). Absent
   * on a schedule built before trades had one.
   */
  headcountLock?: boolean;
  /**
   * Written after the lock day had passed: the details are confirmed as soon
   * as they are in, so Schedule A doesn't promise "30 days before the date"
   * for a date already inside it (an event booked the day it happened, Jess
   * Styles Bridal, 2026-10-12). Absent otherwise, so every agreement written
   * with the lock still ahead reads, and hashes, exactly as before.
   */
  lockPassed?: true;
};

/** Plain content shapes, matching the document module's own. */
type Inline = { text: string; bold?: true; field?: string };
type Block =
  | { type: "heading"; level: 1 | 2; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: Array<{ content: Inline[] }> };

type Category =
  | "getting_ready"
  | "ceremony"
  | "reception"
  | "photo_locations"
  | "venue_logistics"
  | "rehearsal"
  | "times"
  | "guests"
  | "contacts";

const CATEGORY_LABEL: Record<Category, string> = {
  getting_ready: "Getting ready",
  ceremony: "Ceremony",
  reception: "Reception",
  photo_locations: "Photo locations",
  // A DJ's: where to load in, power, the venue's sound limit, a vendor meal.
  venue_logistics: "Load-in and power",
  // A planner's: the rehearsal she runs the day before.
  rehearsal: "Rehearsal",
  times: "Times",
  guests: "Guests",
  contacts: "Contacts",
};

/** The parts a wedding agreement should carry from booking (GR, 2026-10-02). */
export const REQUIRED_WEDDING_PARTS: readonly Category[] = ["getting_ready", "ceremony", "reception", "times"];

/** A DJ's wedding: no getting ready, but the room's load-in and power (trades.ts). */
export const REQUIRED_DJ_WEDDING_PARTS: readonly Category[] = ["ceremony", "reception", "times"];

/** A makeup artist's or hair stylist's wedding: where they get ready, and when they must be ready. */
export const REQUIRED_BEAUTY_WEDDING_PARTS: readonly Category[] = ["getting_ready", "times"];

/**
 * A wedding planner's (docs/planner-journey-plan.md, N6): the ceremony, the
 * reception and the guest count she staffs on. Venue logistics, contacts and
 * the rehearsal are printed when the couple gives them.
 */
export const REQUIRED_PLANNER_WEDDING_PARTS: readonly Category[] = ["ceremony", "reception", "guests"];

const isBeauty = (trade: string | null | undefined) => trade === "makeup" || trade === "hair";
const isPlanner = (trade: string | null | undefined) => trade === "planner";

const normalise = (value: string) =>
  ` ${value
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim()} `;

/**
 * A mitzvah's parts (docs/mitzvah-journey-plan-2026-10-14.md): the service
 * and the party, and the times. A makeup artist or hair stylist needs where
 * the family gets ready and when, as at a wedding.
 */
export const REQUIRED_MITZVAH_PARTS: readonly Category[] = ["ceremony", "reception", "times"];

/**
 * A kind's own Schedule A parts (job-kinds.ts `scheduleAParts`): what its
 * ceremony and reception are called, the words that mean them in a form's
 * questions, and which parts it needs. The wedding's are the defaults, so a
 * kind with parts of its own is a row here (docs/adding-a-job-kind-playbook.md).
 */
type KindParts = {
  ceremony: string;
  reception: string;
  ceremonyWords: readonly string[];
  receptionWords: readonly string[];
  required: readonly Category[];
};

const KIND_PARTS: Record<string, KindParts> = {
  // A mitzvah's: the synagogue is its ceremony, the party its reception.
  mitzvah: {
    ceremony: "Service",
    reception: "Party",
    ceremonyWords: ["synagogue", "temple", "service", "bimah"],
    receptionWords: ["party"],
    required: REQUIRED_MITZVAH_PARTS,
  },
  // A quinceañera's: the Mass is its ceremony, the reception its own.
  quince: {
    ceremony: "Mass",
    reception: "Reception",
    ceremonyWords: ["mass", "church", "parish"],
    receptionWords: ["reception", "party"],
    required: REQUIRED_MITZVAH_PARTS,
  },
  // A vow renewal's: the vows if any, then the reception (an anniversary
  // party has no ceremony, so it isn't required).
  vow_renewal: {
    ceremony: "Vows",
    reception: "Reception",
    ceremonyWords: ["vows", "renewal"],
    receptionWords: ["reception", "celebrating", "party"],
    required: ["reception", "times"],
  },
  // A Sweet 16's: the party, with no service before it.
  sweet16: {
    ceremony: "Location",
    reception: "Party",
    ceremonyWords: [],
    receptionWords: ["party"],
    required: ["reception", "times"],
  },
};

/** A kind's own parts, or undefined for the wedding's (which has no row) and for none. */
const kindParts = (parts: string | null | undefined): KindParts | undefined => (parts ? KIND_PARTS[parts] : undefined);

/** Which part of the day a question is about — or null for anything else. */
export function eventDetailCategory(
  question: string,
  trade?: string | null,
  /** Whose parts (job-kinds.ts `scheduleAParts`): a mitzvah's service and party read as its ceremony and reception. */
  parts?: string | null,
): Category | null {
  const n = normalise(question);
  const has = (...words: string[]) => words.some((word) => n.includes(` ${word}`));
  if (has("date") && !has("time")) return null;
  if (has("restriction", "rule", "note", "anything", "accessib", "allergi", "describe", "how important")) return null;
  // A planner's rehearsal (its day and time, who comes) is a part of its own,
  // before "time" claims it; her key people are the day's contacts.
  if (isPlanner(trade) && has("rehearsal")) return "rehearsal";
  if (isPlanner(trade) && has("key people")) return "contacts";
  // Before times: "Load-in time" is about load-in.
  if (has("load in", "loading", "unload", "power", "outlet", "sound limit", "decibel", "vendor meal")) return "venue_logistics";
  if (has("time", "times", "start", "end", "finish", "arrive", "arrival", "hours")) return "times";
  // A makeup or hair morning: "When does everyone need to be ready?" is its
  // one time, and "How many people…" is the party size it is priced on.
  if (isBeauty(trade) && has("ready by", "be ready")) return "times";
  if (isBeauty(trade) && has("how many people", "party size", "headcount")) return "guests";
  if (has("getting ready", "prep", "preparation", "bridal suite", "dressing")) return "getting_ready";
  if (has("photo", "portrait", "pictures") && has("location", "locations", "stop", "stops", "spot", "spots", "where", "address", "place"))
    return "photo_locations";
  if (has("reception")) return "reception";
  if (has("ceremony", "church", "chapel")) return "ceremony";
  // A kind's own: a mitzvah's synagogue is its ceremony, its party its reception.
  const own = kindParts(parts);
  if (own && has(...own.ceremonyWords)) return "ceremony";
  if (own && has(...own.receptionWords) && !has("bridal party", "wedding party")) return "reception";
  if (has("guest")) return "guests";
  if (has("planner", "coordinator", "day of contact", "call on the day", "venue contact")) return "contacts";
  return null;
}

/**
 * The couple's "not decided yet" (features/questionnaires/field-extras.ts,
 * kept inline so this file has no imports): printed as "To be confirmed", and
 * a part answered only that way is still missing.
 */
const notDecided = (answer: string) => /^\s*(tbd|tbc|to be (decided|determined|confirmed))\s*$/i.test(answer);

/**
 * Pure: the schedule from what the job knows. `answers` are the couple's form
 * rows (question, answer); the date, venue and coverage come from records.
 */
export function eventDetailsFrom(input: {
  eventType: string;
  /**
   * The job's kind (job-kinds.ts). It decides: only a wedding's agreement
   * insists on getting ready, ceremony and reception. An unknown job was
   * treated as a wedding, so a corporate agreement listed "Ceremony: To be
   * confirmed". Omitted: read from the type's label, as before.
   */
  eventKind?: string | null;
  /**
   * What the job's kind asks of Schedule A (job-kinds.ts, passed in since
   * this file has no imports): whether its parts are required from booking
   * (`journeyProfile(kind).scheduleAParts`) and its title
   * (`vocab(kind).detailsForm`). Omitted: read from `eventKind`, or the
   * type's label, as before.
   */
  kindDetails?: { parts: string | null; title: string };
  /** Already formatted for reading: "Saturday, June 12, 2027". */
  date: string | null;
  venue: string | null;
  coverage: string | null;
  answers: ReadonlyArray<{ question: string; answer: string }>;
  /**
   * When the final details lock: the studio's planning timeline for a kind
   * that locks, null for one that doesn't. Omitted: a wedding locks at 28
   * days, anything else doesn't.
   */
  lockDaysBefore?: number | null;
  /** The studio's trade (trades.ts): a DJ's wedding doesn't need getting ready. */
  trade?: string | null;
  /**
   * The lock day had passed when the agreement was written
   * (contracts/sources.ts, from the day it is prepared). Only read when
   * there is a lock.
   */
  lockPassed?: boolean;
}): EventDetails {
  const parts = input.kindDetails?.parts;
  const own = kindParts(parts);
  const wedding = input.kindDetails
    ? parts !== null && parts !== undefined
    : input.eventKind
      ? input.eventKind === "wedding"
      : /wedding/i.test(input.eventType);
  const required =
    own
      ? isBeauty(input.trade)
        ? REQUIRED_BEAUTY_WEDDING_PARTS
        : own.required
      : input.trade === "dj"
      ? REQUIRED_DJ_WEDDING_PARTS
      : isBeauty(input.trade)
        ? REQUIRED_BEAUTY_WEDDING_PARTS
        : isPlanner(input.trade)
          ? REQUIRED_PLANNER_WEDDING_PARTS
          : REQUIRED_WEDDING_PARTS;
  const sorted = new Map<Category, EventDetailRow[]>();
  for (const row of input.answers) {
    const question = row.question.trim();
    const answer = row.answer.trim();
    if (!question || !answer) continue;
    const category = eventDetailCategory(question, input.trade, parts);
    if (!category) continue;
    const list = sorted.get(category) ?? [];
    list.push({ label: question.replace(/[:?]\s*$/, ""), value: notDecided(answer) ? "To be confirmed" : answer });
    sorted.set(category, list);
  }
  // One venue for the whole day: a wedding's ceremony is there unless they
  // said otherwise. A kind with its own parts books the party's venue — the
  // mitzvah's party, the quinceañera's reception — never the synagogue's or
  // the church's: Schedule A read "Mass: Salón Las Palmas" (quince walk, 2026-10-15).
  const venuePart: Category = own ? "reception" : "ceremony";
  if (!sorted.has(venuePart) && input.venue?.trim()) sorted.set(venuePart, [{ label: "Venue", value: input.venue.trim() }]);
  // Away from a wedding there is no ceremony: the venue is the location.
  const label = (category: Category) =>
    // A mitzvah's ceremony is the service, its reception the party.
    own && (category === "ceremony" || category === "reception")
      ? category === "ceremony" ? own.ceremony : own.reception
      : !wedding && category === "ceremony"
      ? "Location"
      : // A makeup artist or hair stylist isn't at the ceremony: it's the venue.
        isBeauty(input.trade) && category === "ceremony"
        ? "Venue"
        : isBeauty(input.trade) && category === "guests"
        ? "Party size"
        : CATEGORY_LABEL[category];

  // A required part, as the studio and the client read it: a mitzvah's service and party.
  const partName = (category: Category) =>
    own && category === "ceremony"
      ? own.ceremony
      : own && category === "reception"
        ? own.reception
        : CATEGORY_LABEL[category];

  const rows: EventDetailRow[] = [];
  if (input.date) rows.push({ label: "Date", value: input.date });
  // A photographer's "Coverage"; a DJ's, makeup artist's or hair stylist's
  // "Service" (trades.ts `coverage`, written out because this file has no
  // imports). An unknown trade is a photographer, as tradeOf() reads it.
  const vendor = ["dj", "makeup", "hair", "planner"].includes(String(input.trade ?? "").trim().toLowerCase());
  // A mitzvah's "Service" is the one at the synagogue, so a vendor's row is
  // what was booked (prod walk, 2026-10-14: two "Service" rows).
  if (input.coverage) rows.push({ label: vendor ? (own ? "Booked" : "Service") : "Coverage", value: input.coverage });
  const order: Category[] = ["getting_ready", "ceremony", "reception", "photo_locations", "venue_logistics", "rehearsal", "times", "guests", "contacts"];
  const missing: string[] = [];
  for (const category of order) {
    const entries = sorted.get(category) ?? [];
    if (wedding && required.includes(category) && entries.length && entries.every((entry) => entry.value === "To be confirmed"))
      missing.push(partName(category));
    if (!entries.length) {
      if (wedding && required.includes(category)) {
        missing.push(partName(category));
        rows.push({ label: partName(category), value: "To be confirmed" });
      }
      continue;
    }
    // One answer: the part's own name. Several: each by its question, so
    // "Bride getting ready" and "Groom getting ready" both read.
    if (entries.length === 1) rows.push({ label: label(category), value: entries[0]!.value });
    else for (const entry of entries) rows.push({ label: entry.label, value: entry.value });
  }
  const title =
    input.kindDetails?.title ??
    (wedding ? "Wedding details" : input.eventKind === "portraits" ? "Session details" : "Event details");
  const lockDaysBefore = input.lockDaysBefore === undefined ? (wedding ? 28 : null) : input.lockDaysBefore;
  const locks = typeof lockDaysBefore === "number" && Number.isFinite(lockDaysBefore) && lockDaysBefore > 0;
  return {
    title,
    rows: rows.slice(0, 40),
    missing,
    lockDaysBefore,
    ...(isBeauty(input.trade) ? { headcountLock: true } : {}),
    ...(locks && input.lockPassed === true ? { lockPassed: true as const } : {}),
  };
}

/**
 * Where the event is, from the couple's own answers — for a job whose records
 * have no venue.
 *
 * GR Productions, 2026-10-06: Tiffany gave "Christ the King" and "Brooklake
 * Country Club" on the event details form, the job's venue stayed blank, and
 * the agreement's Venue field held the whole contract back from auto-send.
 * The answers were already in Schedule A; the field above it never read them.
 *
 * A question that asks for the venue itself wins ("Venue", "Event location");
 * otherwise the ceremony's place, then the reception's, both when they
 * differ. Only place questions count — "Ceremony officiant" is about the
 * ceremony but is not where it is — and "TBD" is not a venue.
 */
export function venueFromAnswers(answers: ReadonlyArray<{ question: string; answer: string }>): string | null {
  const given = answers
    .map((row) => ({ question: row.question.trim(), answer: row.answer.trim() }))
    .filter((row) => row.question && row.answer && !notDecided(row.answer));
  const venueQuestion = (question: string) =>
    /^ (event |wedding |session )?(venue|location)( name)?( and address| address)? $/.test(normalise(question));
  const asked = given.find((row) => venueQuestion(row.question));
  if (asked) return asked.answer;
  const place = (question: string) =>
    [" location", " venue", " address", " where", " place", " church", " chapel"].some((word) => normalise(question).includes(word));
  const placeFor = (category: Category) =>
    given.find((row) => eventDetailCategory(row.question) === category && place(row.question))?.answer ?? null;
  const ceremony = placeFor("ceremony");
  const reception = placeFor("reception");
  if (ceremony && reception && normalise(ceremony) !== normalise(reception)) return `${ceremony} and ${reception}`;
  return ceremony ?? reception;
}

/** What Schedule A says about changes: the lock, when this job has one. */
function lockSentence(lockDaysBefore: number | null | undefined, headcountLock = false, lockPassed = false): string {
  // Undefined: a schedule built before the lock was per kind — the wedding's four weeks.
  if (lockDaysBefore === undefined) lockDaysBefore = 28;
  if (lockDaysBefore === null || !Number.isFinite(lockDaysBefore) || lockDaysBefore <= 0) {
    return "These details form part of this agreement. Anything marked \"To be confirmed\" is added once it is decided.";
  }
  const when =
    lockDaysBefore % 7 === 0
      ? `${["", "one", "two", "three", "four", "five", "six", "seven", "eight"][lockDaysBefore / 7] || lockDaysBefore / 7} week${lockDaysBefore === 7 ? "" : "s"}`
      : `${lockDaysBefore} days`;
  // Written on or after the lock day: no promise of a day that has gone. The
  // headcount is counted from the party list (trades.ts `detailsForm`, the
  // same words for makeup and hair).
  if (lockPassed && headcountLock)
    return `These details form part of this agreement. The date is within ${when}, so the final headcount is confirmed as soon as the party list is in, and anything marked "To be confirmed" is added then. After that, people can be added but not taken off, and changes to times or the location are agreed with us in writing.`;
  if (lockPassed)
    return `These details form part of this agreement. The date is within ${when}, so the final details are confirmed as soon as the booking is made, and anything marked "To be confirmed" is added once it is decided. After that, changes to locations or times are agreed with us in writing.`;
  if (headcountLock)
    return `These details form part of this agreement. Anything marked "To be confirmed" is added when the final headcount is confirmed, ${when} before the date. After that, people can be added but not taken off, and changes to times or the location are agreed with us in writing.`;
  return `These details form part of this agreement. Anything marked "To be confirmed" is added when the final details are confirmed, ${when} before the date. After that, changes to locations or times are agreed with us in writing.`;
}

/**
 * Schedule B — a bar or bat mitzvah's terms (docs/mitzvah-journey-plan-2026-10-14.md,
 * Phase 5). Added at the end of the agreement for a mitzvah job only
 * (job-kinds.ts `agreementTerms`), the way Schedule A is, so a wedding's
 * agreement is word for word what it was.
 *
 * Two terms a wedding doesn't need: the congregation's rules (cameras, sound
 * and setup are often kept out of the service), and children (most guests
 * are children, and their images are not the studio's to show). In the
 * trade's own words; the trade is passed in, since this file has no imports.
 *
 * DRAFT: written for counsel's review with the e-sign review. Not legal advice.
 */
export function mitzvahTermsBlocks(trade?: string | null): Block[] {
  const field = "event.terms";
  const which = String(trade ?? "").trim().toLowerCase();
  const worship =
    which === "dj"
      ? "The Studio follows the rules of the synagogue or congregation for music, sound and announcements, which may keep equipment out of the service or limit when and where the Studio can play. Anything those rules exclude is not part of the services and is not a shortfall."
      : which === "makeup" || which === "hair"
        ? "The Studio follows the rules of the synagogue or congregation for where and when it may work, and its dress and timing. Anything those rules exclude is not part of the services and is not a shortfall."
        : which === "planner"
          ? "The Studio works within the rules of the synagogue or congregation for the service, the rehearsal and the portraits, and coordinates with its staff. Anything those rules exclude is not part of the services and is not a shortfall."
          : "The Studio follows the rules of the synagogue or congregation for photography and video, which often keep cameras out of the service and may limit when and where the Studio can photograph. Anything those rules exclude is not part of the services and is not a shortfall.";
  const children =
    which === "dj"
      ? "Many guests at a mitzvah are children. The Studio plays music and runs games suited to their ages, and keeps explicit lyrics out while children are present unless the Client asks otherwise in writing."
      : which === "makeup" || which === "hair"
        ? "Services for anyone under 18 are given with a parent or guardian present, and with products suited to their age."
        : which === "planner"
          ? "Many guests at a mitzvah are children. The Client remains responsible for supervising them: the Studio coordinates the event and does not provide childcare."
          : "Many guests at a mitzvah are children. The Studio will not use images of the honoree, or of any other child from this event, in its portfolio, website, social media, competitions or advertising unless the Client agrees in writing. The images delivered are for the family's personal use.";
  return [
    { type: "heading", level: 2, content: [{ text: "Schedule B — Bar and bat mitzvah terms", field }] },
    // The studio's own terms may grant image use or say otherwise (a prod
    // walk's agreement gave the studio every image for advertising): these
    // win for this event, or the agreement contradicts itself.
    {
      type: "paragraph",
      content: [{ text: "These terms are part of this agreement for this event. Where they differ from the terms above, these apply.", field }],
    },
    {
      type: "list",
      items: [
        { content: [{ text: "The house of worship: ", bold: true as const, field }, { text: worship, field }] },
        { content: [{ text: "Children: ", bold: true as const, field }, { text: children, field }] },
      ],
    },
  ];
}

/**
 * Schedule B — a quinceañera's terms (docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 1). Added for a quinceañera job only (job-kinds.ts `agreementTerms`).
 * Two terms a wedding doesn't need: the parish's rules for the Mass, and the
 * court and the honoree, who are mostly minors. In the trade's own words.
 *
 * DRAFT: shipped before counsel's review (Conor, 2026-10-15). Not legal advice.
 */
export function quinceTermsBlocks(trade?: string | null): Block[] {
  const field = "event.terms";
  const which = String(trade ?? "").trim().toLowerCase();
  const church =
    which === "dj"
      ? "The Studio follows the parish's rules for music, sound and announcements, which may keep equipment out of the Mass or limit when and where the Studio can play. Anything those rules exclude is not part of the services and is not a shortfall."
      : which === "makeup" || which === "hair"
        ? "The Studio follows the parish's rules for where and when it may work, and the Mass's timing. Anything those rules exclude is not part of the services and is not a shortfall."
        : which === "planner"
          ? "The Studio works within the parish's rules for the Mass, any rehearsal and the portraits, and coordinates with its staff. Anything those rules exclude is not part of the services and is not a shortfall."
          : "The Studio follows the parish's rules for photography and video, which may keep cameras out of the Mass, allow them only before or after it, or only from the back without flash. Anything those rules exclude is not part of the services and is not a shortfall.";
  const minors =
    which === "dj"
      ? "The quinceañera and most of her court are minors. The Studio plays music suited to their ages, and keeps explicit lyrics out while they are on the floor unless the Client asks otherwise in writing."
      : which === "makeup" || which === "hair"
        ? "Services for anyone under 18 are given with a parent or guardian present, and with products suited to their age."
        : which === "planner"
          ? "The quinceañera and most of her court are minors. The Client remains responsible for supervising them, including at rehearsals: the Studio coordinates the event and does not provide childcare."
          : "The quinceañera and most of her court are minors. The Studio will not use images of the quinceañera, or of any other minor from this event, in its portfolio, website, social media, competitions or advertising unless the Client agrees in writing. The images delivered are for the family's personal use.";
  return [
    { type: "heading", level: 2, content: [{ text: "Schedule B — Quinceañera terms", field }] },
    {
      type: "paragraph",
      content: [{ text: "These terms are part of this agreement for this event. Where they differ from the terms above, these apply.", field }],
    },
    {
      type: "list",
      items: [
        { content: [{ text: "The church: ", bold: true as const, field }, { text: church, field }] },
        { content: [{ text: "Minors: ", bold: true as const, field }, { text: minors, field }] },
      ],
    },
  ];
}

/**
 * Schedule B — a Sweet 16's terms (docs/new-job-kinds-execution-plan-2026-10-15.md,
 * Phase 2). Added for a Sweet 16 job only (job-kinds.ts `agreementTerms`).
 * One term a wedding doesn't need: the honoree and most guests are minors.
 * In the trade's own words.
 *
 * DRAFT: shipped before counsel's review, as the quinceañera's. Not legal advice.
 */
export function sweet16TermsBlocks(trade?: string | null): Block[] {
  const field = "event.terms";
  const which = String(trade ?? "").trim().toLowerCase();
  const minors =
    which === "dj"
      ? "The honoree and most guests are minors. The Studio plays music suited to their ages, and keeps explicit lyrics out while they are on the floor unless the Client asks otherwise in writing."
      : which === "makeup" || which === "hair"
        ? "Services for anyone under 18 are given with a parent or guardian present, and with products suited to their age."
        : which === "planner"
          ? "The honoree and most guests are minors. The Client remains responsible for supervising them: the Studio coordinates the event and does not provide childcare."
          : "The honoree and most guests are minors. The Studio will not use images of the honoree, or of any other minor from this event, in its portfolio, website, social media, competitions or advertising unless the Client agrees in writing. The images delivered are for the family's personal use.";
  return [
    { type: "heading", level: 2, content: [{ text: "Schedule B — Sweet 16 terms", field }] },
    {
      type: "paragraph",
      content: [{ text: "These terms are part of this agreement for this event. Where they differ from the terms above, these apply.", field }],
    },
    {
      type: "list",
      items: [{ content: [{ text: "Minors: ", bold: true as const, field }, { text: minors, field }] }],
    },
  ];
}

/** The schedule as agreement blocks: a heading, what it means, the details. */
export function eventDetailsBlocks(details: EventDetails): Block[] {
  if (!details.rows.length) return [];
  const field = "event.details";
  return [
    { type: "heading", level: 2, content: [{ text: `Schedule A — ${details.title}`, field }] },
    {
      type: "paragraph",
      content: [
        {
          text: lockSentence(details.lockDaysBefore, details.headcountLock === true, details.lockPassed === true),
          field,
        },
      ],
    },
    {
      type: "list",
      items: details.rows.map((row) => ({
        content: [
          { text: `${row.label}: `, bold: true as const, field },
          { text: row.value, field },
        ],
      })),
    },
  ];
}

/**
 * Each kind's Schedule B (job-kinds.ts `agreementTerms`), in the trade's own
 * words. A kind with terms of its own is a row here
 * (docs/adding-a-job-kind-playbook.md); none for any other kind.
 */
const KIND_TERMS: Record<string, (trade?: string | null) => Block[]> = {
  mitzvah: mitzvahTermsBlocks,
  quince: quinceTermsBlocks,
  sweet16: sweet16TermsBlocks,
};

/** The kind's Schedule B blocks, or null when its agreement has none. */
export function kindTermsBlocks(terms: string | null | undefined, trade?: string | null): Block[] | null {
  const write = terms ? KIND_TERMS[terms] : undefined;
  return write ? write(trade) : null;
}
