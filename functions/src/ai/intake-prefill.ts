/**
 * Deterministic prefill for manual project creation.
 *
 * A photographer's "new project" usually starts as an email or a text: paste
 * it, and this picks out what a regex can find with confidence — a date, an
 * email address, a phone number, a venue after "at", names before "and".
 * Pure function, no I/O, no AI: everything it extracts lands in editable
 * fields the studio confirms, and anything it can't find it leaves alone.
 */

export type ProjectIntakeExtraction = {
  eventDate: string | null; // YYYY-MM-DD
  eventType: "Wedding" | "Mitzvah" | "Family" | "Corporate" | "Sports" | "Other" | null;
  email: string | null;
  phone: string | null;
  venueName: string | null;
  city: string | null;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
  /** The particular occasion, when it is more than the kind of job: "Sangeet". */
  occasion: string | null;
  /** When everyone must be ready, as HH:MM: "hair done by 5:30 PM" → "17:30". */
  readyByTime: string | null;
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const pad = (value: number) => String(value).padStart(2, "0");

const valid = (year: number, month: number, day: number): string | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return `${year}-${pad(month)}-${pad(day)}`;
};

function extractDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const result = valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (result) return result;
  }
  const worded = text.match(
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i,
  );
  if (worded?.[1] && worded[2] && worded[3]) {
    const month = MONTHS[worded[1].toLowerCase()];
    if (month) {
      const result = valid(Number(worded[3]), month, Number(worded[2]));
      if (result) return result;
    }
  }
  const slashed = text.match(/\b(\d{1,2})[/](\d{1,2})[/](\d{2,4})\b/);
  if (slashed?.[1] && slashed[2] && slashed[3]) {
    const year =
      slashed[3].length === 2 ? 2000 + Number(slashed[3]) : Number(slashed[3]);
    // US convention: month/day/year.
    const result = valid(year, Number(slashed[1]), Number(slashed[2]));
    if (result) return result;
  }
  return null;
}

function extractEventType(text: string): ProjectIntakeExtraction["eventType"] {
  const lowered = text.toLowerCase();
  // Before the wedding words: "the bat mitzvah ceremony" is a mitzvah.
  if (/\bb(?:a[rt]|'?nai|'?not)[\s-]*mitzv|\bmitzvah/.test(lowered))
    return "Mitzvah";
  if (/\bwedding|bride|groom|fianc|marri|engag|elop/.test(lowered))
    return "Wedding";
  if (/\bcorporate|conference|summit|company event|gala\b/.test(lowered))
    return "Corporate";
  if (/\bsports?|tournament|match day|game day|cheer\b/.test(lowered))
    return "Sports";
  if (/\bfamily (photos|session|shoot)|newborn|maternity|senior (photos|portraits)|portrait session|headshots?\b/.test(lowered))
    return /headshot/.test(lowered) ? "Corporate" : "Family";
  return null;
}

const PROPER = "[A-Z][\\w''.-]+";

// The proper-noun pattern accepts internal punctuation ("O'Brien",
// "St.John") which also swallows sentence-ending marks; strip those, and
// collapse any whitespace an email's hard line-wrapping left inside a
// captured phrase ("The\nRyland Inn").
const cleanName = (value: string | null | undefined): string | null => {
  const trimmed =
    value?.replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "").trim() ?? "";
  return trimmed || null;
};

function extractVenue(text: string): string | null {
  const labeled = text.match(/venue[:\s]+([^\n,.]{3,60})/i);
  if (labeled?.[1]) return labeled[1].trim();
  const at = text.match(
    new RegExp(`\\bat\\s+((?:[Tt]he\\s+)?${PROPER}(?:\\s+${PROPER}){0,4})`),
  );
  return cleanName(at?.[1]);
}

function extractCity(text: string): string | null {
  const labeled = text.match(/city[:\s]+([^\n,.]{2,60})/i);
  if (labeled?.[1]) return labeled[1].trim();
  const inMatch = text.match(
    new RegExp(`\\bin\\s+(${PROPER}(?:\\s+${PROPER}){0,2})(?:,\\s*([A-Z]{2}))?\\b`),
  );
  const place = cleanName(inMatch?.[1]);
  if (!place) return null;
  return inMatch?.[2] ? `${place}, ${inMatch[2]}` : place;
}

/**
 * The occasion a message is about, when it is more particular than the kind
 * of job. "Hair for her Sangeet tonight" is a Sangeet: the job's kind is still
 * a wedding, but its name should say Sangeet, not "wedding" (Priya Shah, Jess
 * Styles Bridal, 2026-10-12). A message about the wedding itself is not about
 * an occasion it mentions — "we're also having a rehearsal dinner" in a
 * wedding inquiry is not what the job is for — unless the occasion is what
 * they ask for and the wedding is not ("you did my wedding hair … could you do
 * my Sangeet?"). Two occasions are several events, which the studio names. A
 * null name keeps the message's words.
 */
const OCCASIONS: ReadonlyArray<readonly [RegExp, string | null]> = [
  [/\bsangeet\b/i, "Sangeet"],
  [/\bmehe?ndi\b/i, "Mehndi"],
  [/\bhaldi\b/i, "Haldi"],
  [/\bgarba\b/i, "Garba"],
  [/\bnikk?ah\b/i, "Nikah"],
  [/\bwalima\b/i, "Walima"],
  [/\brehearsal dinner\b/i, null],
  [/\bwelcome (?:party|dinner)\b/i, null],
  [/\bengagement (?:party|shoot|session|photos)\b/i, null],
  [/\b(?:bridal|baby) shower\b/i, null],
  [/\bbachelorette party\b/i, null],
  [/\bquincea(?:n|ñ)era\b/i, "quinceañera"],
  [/\bba[rt] mitzvah\b/i, null],
  [/\bvow renewal\b/i, null],
];

/** Words that are the kind of job, or no occasion at all: never a name's occasion. */
const NOT_AN_OCCASION =
  /^(?:wedding|wedding day|ceremony|reception|event|session|party|day|celebration|shoot|job|booking)$/i;

/**
 * An occasion as a job's name can carry it: one short line, without the
 * article a sentence gives it ("her Sangeet"), and never just the kind of job.
 * Shared by the deterministic read and the AI's (functions/src/ai/copilot.ts).
 */
export function cleanOccasion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const occasion = value
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:the|her|his|their|my|our|your|a|an)\s+/i, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
  if (!occasion || occasion.length > 60 || NOT_AN_OCCASION.test(occasion)) return null;
  return occasion;
}

/** "for her …", "do my …", "book our …": what the message asks the studio for. */
const ASKED_FOR = String.raw`\b(?:for|do|book|style|cover)\s+(?:(?:her|his|their|my|our|the|a|an)\s+)?`;

/** The wedding itself, however it is said: "wedding", "getting married". */
const WEDDING = /\b(?:wedding|married|marry|marriage)\b/i;

function extractOccasion(text: string): string | null {
  const found: Array<{ name: string; asked: boolean }> = [];
  for (const [pattern, name] of OCCASIONS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const asked = new RegExp(ASKED_FOR + pattern.source, "i").test(text);
    found.push({ name: name ?? match[0].toLowerCase().replace(/\s+/g, " "), asked });
  }
  if (found.length !== 1) return null;
  const [occasion] = found;
  if (!WEDDING.test(text)) return occasion!.name;
  return occasion!.asked && !weddingAskedFor(text) ? occasion!.name : null;
}

/** The wedding itself is what they ask for: "for our wedding", never "my wedding hair". */
function weddingAskedFor(text: string): boolean {
  return new RegExp(ASKED_FOR + String.raw`wedding\b(?!\s+(?:hair|makeup))`, "i").test(text);
}

/**
 * The occasion an AI read named, held to the rule the read above keeps
 * (extractOccasion), which the model's own judgement does not.
 *
 * A photographer's "wedding June 6, and we'd love an engagement session too"
 * could come back as an engagement session: the job would be named for it and
 * its draft told never to say wedding (review, 2026-10-12). So the occasion is
 * kept only when its name can carry it (cleanOccasion), the message names no
 * second occasion, and — when the message is about a wedding at all — the
 * occasion is what they ask for and the wedding is not. A message with no
 * wedding in it ("makeup for my 40th birthday party") keeps the model's words.
 */
export function occasionFromRead(message: unknown, occasion: unknown): string | null {
  const cleaned = cleanOccasion(occasion);
  const text = typeof message === "string" ? message.trim() : "";
  if (!cleaned || !text) return null;
  if (OCCASIONS.filter(([pattern]) => pattern.test(text)).length > 1) return null;
  if (!WEDDING.test(text)) return cleaned;
  if (weddingAskedFor(text)) return null;
  // The occasion's own words in the message: its known spellings ("Mehndi"
  // is also "mehendi"), or what the model wrote.
  const known = OCCASIONS.find(([pattern]) => pattern.test(cleaned));
  const words = known
    ? known[0].source
    : cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, String.raw`\s+`);
  return new RegExp(ASKED_FOR + words, "i").test(text) ? cleaned : null;
}

/**
 * A time already on a 24-hour clock, zero-padded, as the form's time field and
 * createProject keep it: "07:00" as it is. Read again as free text, an early
 * time with no AM or PM is dropped ("07:00" could be a guess at "7:00"), so a
 * time that has been read once is checked, never re-read. Anything else null.
 */
export function storedClock(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

/**
 * A time as an inquiry's ready-by answer is read (functions/src/planning/
 * job-facts.ts spokenClock): "5:30 PM", "noon", "17:30" → HH:MM. With no AM or
 * PM only a morning or midday hour is taken — "5:30" could be either end of
 * the day — and a bare hour ("by 5") is not a time.
 */
export function readyByClock(value: unknown): string | null {
  const raw = (typeof value === "string" ? value : "")
    .toLowerCase()
    .replace(/([ap])\.\s*m\b\.?/g, "$1m")
    .trim()
    .replace(/^(?:by|at|around|about)\s+/, "")
    .replace(/[.!]+$/, "")
    .replace(/\s+/g, "");
  if (/^(?:12)?noon$/.test(raw)) return "12:00";
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(raw);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3] ?? null;
  if (!half && !match[2]) return null;
  if (half === "pm" && hour < 12) hour += 12;
  if (half === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  if (!half && hour < 8) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * When everyone has to be ready, in the message's own words: "hair done by
 * 5:30 PM", "everyone ready by noon". Never a start or arrival time ("guests
 * arrive at 6:00 PM"): the ready-by is earlier, and guessing it would put the
 * wrong time on the party list.
 */
function extractReadyBy(text: string): string | null {
  const match =
    /\b(?:ready|done|finished|styled|complete(?:d)?)\s+(?:by|before|for|at|no later than)\s+(noon|\d{1,2}(?::\d{2})?(?:\s*[ap]\.?\s?m\b\.?)?)/i.exec(
      text,
    );
  return match?.[1] ? readyByClock(match[1]) : null;
}

// Words that end an email and are never a signature name.
const CLOSINGS = new Set([
  "thanks", "thank", "best", "regards", "cheers", "sincerely", "warmly",
  "talk", "soon", "xo", "xoxo", "hi", "hello", "hey",
]);

function signatureName(raw: string): string | null {
  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || /\d|@/.test(last)) return null;
  const words = last.replace(/[.,;:!]+$/, "").split(/\s+/);
  if (words.length < 1 || words.length > 3) return null;
  const properWords = words.every(
    (word) =>
      /^[A-Z]/.test(word) && !CLOSINGS.has(word.toLowerCase()),
  );
  return properWords ? words.join(" ") : null;
}

function extractNames(
  text: string,
  raw: string,
): {
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
} {
  // "I'm Ava" / "My name is Ava Chen" / "This is Ava" — the phrase is
  // matched in either capitalization; the NAME must stay capitalized, so
  // the whole pattern cannot simply be case-insensitive.
  const intro = text.match(
    new RegExp(
      `\\b(?:I'?m|I am|[Mm]y name is|[Tt]his is|[Ww]e'?re|[Ww]e are)\\s+(${PROPER})(?:\\s+(${PROPER}))?`,
    ),
  );
  // "Ava and Liam" / "Ava & Liam" — the couple pattern.
  const couple = text.match(
    new RegExp(`\\b(${PROPER})\\s+(?:and|&)\\s+(${PROPER})\\b`),
  );
  const signature = signatureName(raw);
  const signatureWords = signature?.split(" ") ?? [];
  const firstName = cleanName(
    intro?.[1] ?? couple?.[1] ?? signatureWords[0],
  );
  const lastName = cleanName(intro?.[2] ?? signatureWords[1]);
  let partnerName =
    couple && cleanName(couple[1]) !== firstName
      ? cleanName(couple[1])
      : cleanName(couple?.[2]);
  // "Diego and I just got engaged" — the partner is the one named next to
  // "I". Skip candidates that are actually the sender's own first or last
  // name ("Maren Castillo and I …").
  if (!partnerName || partnerName === lastName) {
    for (const match of text.matchAll(
      new RegExp(`\\b(${PROPER})\\s+(?:and|&)\\s+I\\b`, "g"),
    )) {
      const candidate = cleanName(match[1]);
      if (candidate && candidate !== firstName && candidate !== lastName) {
        partnerName = candidate;
        break;
      }
    }
  }
  return {
    firstName,
    lastName,
    partnerName:
      partnerName === firstName || partnerName === lastName
        ? null
        : partnerName,
  };
}

export function deterministicIntakeExtraction(raw: string): ProjectIntakeExtraction {
  const text = raw.trim();
  if (!text) {
    return {
      eventDate: null,
      eventType: null,
      email: null,
      phone: null,
      venueName: null,
      city: null,
      firstName: null,
      lastName: null,
      partnerName: null,
      occasion: null,
      readyByTime: null,
    };
  }
  const email =
    text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
  const phone =
    text.match(
      /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    )?.[0] ?? null;
  return {
    eventDate: extractDate(text),
    eventType: extractEventType(text),
    email,
    phone: phone?.trim() ?? null,
    venueName: extractVenue(text),
    city: extractCity(text),
    ...extractNames(text, raw),
    occasion: extractOccasion(text),
    readyByTime: extractReadyBy(text),
  };
}

// Provenance note: this file mirrors features/crm/project-prefill.ts in the
// app package (functions builds standalone and cannot import across the
// boundary). It serves as the mock-mode extractor and the live fallback when
// Vertex is unreachable — keep the two in sync when the engine changes.
