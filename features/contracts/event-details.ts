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
};

/** Plain content shapes, matching the document module's own. */
type Inline = { text: string; bold?: true; field?: string };
type Block =
  | { type: "heading"; level: 1 | 2; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "list"; items: Array<{ content: Inline[] }> };

type Category = "getting_ready" | "ceremony" | "reception" | "photo_locations" | "times" | "guests" | "contacts";

const CATEGORY_LABEL: Record<Category, string> = {
  getting_ready: "Getting ready",
  ceremony: "Ceremony",
  reception: "Reception",
  photo_locations: "Photo locations",
  times: "Times",
  guests: "Guests",
  contacts: "Contacts",
};

/** The parts a wedding agreement should carry from booking (GR, 2026-10-02). */
export const REQUIRED_WEDDING_PARTS: readonly Category[] = ["getting_ready", "ceremony", "reception", "times"];

const normalise = (value: string) =>
  ` ${value
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim()} `;

/** Which part of the day a question is about — or null for anything else. */
export function eventDetailCategory(question: string): Category | null {
  const n = normalise(question);
  const has = (...words: string[]) => words.some((word) => n.includes(` ${word}`));
  if (has("date") && !has("time")) return null;
  if (has("restriction", "rule", "note", "anything", "accessib", "allergi", "describe", "how important")) return null;
  if (has("time", "times", "start", "end", "finish", "arrive", "arrival", "hours")) return "times";
  if (has("getting ready", "prep", "preparation", "bridal suite", "dressing")) return "getting_ready";
  if (has("photo", "portrait", "pictures") && has("location", "locations", "stop", "stops", "spot", "spots", "where", "address", "place"))
    return "photo_locations";
  if (has("reception")) return "reception";
  if (has("ceremony", "church", "chapel")) return "ceremony";
  if (has("guest")) return "guests";
  if (has("planner", "coordinator", "day of contact", "call on the day", "venue contact")) return "contacts";
  return null;
}

/**
 * Pure: the schedule from what the job knows. `answers` are the couple's form
 * rows (question, answer); the date, venue and coverage come from records.
 */
export function eventDetailsFrom(input: {
  eventType: string;
  /** Already formatted for reading: "Saturday, June 12, 2027". */
  date: string | null;
  venue: string | null;
  coverage: string | null;
  answers: ReadonlyArray<{ question: string; answer: string }>;
}): EventDetails {
  const wedding = /wedding/i.test(input.eventType) || !input.eventType.trim();
  const sorted = new Map<Category, EventDetailRow[]>();
  for (const row of input.answers) {
    const question = row.question.trim();
    const answer = row.answer.trim();
    if (!question || !answer) continue;
    const category = eventDetailCategory(question);
    if (!category) continue;
    const list = sorted.get(category) ?? [];
    list.push({ label: question.replace(/[:?]\s*$/, ""), value: answer });
    sorted.set(category, list);
  }
  // One venue for the whole day: the ceremony is there unless they said otherwise.
  if (!sorted.has("ceremony") && input.venue?.trim()) sorted.set("ceremony", [{ label: "Venue", value: input.venue.trim() }]);

  const rows: EventDetailRow[] = [];
  if (input.date) rows.push({ label: "Date", value: input.date });
  if (input.coverage) rows.push({ label: "Coverage", value: input.coverage });
  const order: Category[] = ["getting_ready", "ceremony", "reception", "photo_locations", "times", "guests", "contacts"];
  const missing: string[] = [];
  for (const category of order) {
    const entries = sorted.get(category) ?? [];
    if (!entries.length) {
      if (wedding && REQUIRED_WEDDING_PARTS.includes(category)) {
        missing.push(CATEGORY_LABEL[category]);
        rows.push({ label: CATEGORY_LABEL[category], value: "To be confirmed" });
      }
      continue;
    }
    // One answer: the part's own name. Several: each by its question, so
    // "Bride getting ready" and "Groom getting ready" both read.
    if (entries.length === 1) rows.push({ label: CATEGORY_LABEL[category], value: entries[0]!.value });
    else for (const entry of entries) rows.push({ label: entry.label, value: entry.value });
  }
  return { title: wedding ? "Wedding details" : "Event details", rows: rows.slice(0, 40), missing };
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
          text:
            "These details form part of this agreement. Anything marked \"To be confirmed\" is added when the final details are confirmed, four weeks before the date. After that, changes to locations or times are agreed with us in writing.",
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
