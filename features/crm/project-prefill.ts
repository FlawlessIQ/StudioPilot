/**
 * Deterministic prefill for manual project creation.
 *
 * A photographer's "new project" usually starts as an email or a text: paste
 * it, and this picks out what a regex can find with confidence — a date, an
 * email address, a phone number, a venue after "at", names before "and".
 * Pure function, no I/O, no AI: everything it extracts lands in editable
 * fields the studio confirms, and anything it can't find it leaves alone.
 */

export type ProjectPrefill = {
  eventDate: string | null; // YYYY-MM-DD
  eventType: "Wedding" | "Corporate" | "Sports" | null;
  email: string | null;
  phone: string | null;
  venueName: string | null;
  city: string | null;
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
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

function extractEventType(text: string): ProjectPrefill["eventType"] {
  const lowered = text.toLowerCase();
  if (/\bwedding|bride|groom|fianc/.test(lowered)) return "Wedding";
  if (/\bcorporate|conference|summit|company event|gala\b/.test(lowered))
    return "Corporate";
  if (/\bsports?|tournament|match day|game day\b/.test(lowered))
    return "Sports";
  return null;
}

const PROPER = "[A-Z][\\w''.-]+";

// The proper-noun pattern accepts internal punctuation ("O'Brien",
// "St.John") which also swallows sentence-ending marks; strip those.
const cleanName = (value: string | null | undefined): string | null => {
  const trimmed = value?.replace(/[.,;:!?]+$/, "").trim() ?? "";
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
  if (!inMatch?.[1]) return null;
  return inMatch[2] ? `${inMatch[1]}, ${inMatch[2]}` : inMatch[1];
}

function extractNames(text: string): {
  firstName: string | null;
  lastName: string | null;
  partnerName: string | null;
} {
  // "I'm Ava" / "my name is Ava Chen" / "this is Ava".
  const intro = text.match(
    new RegExp(
      `\\b(?:I'?m|I am|my name is|this is)\\s+(${PROPER})(?:\\s+(${PROPER}))?`,
    ),
  );
  // "Ava and Liam" / "Ava & Liam" — the couple pattern.
  const couple = text.match(
    new RegExp(`\\b(${PROPER})\\s+(?:and|&)\\s+(${PROPER})\\b`),
  );
  const firstName = cleanName(intro?.[1] ?? couple?.[1]);
  const lastName = cleanName(intro?.[2]);
  const rawPartner =
    couple && cleanName(couple[1]) !== firstName
      ? cleanName(couple[1])
      : cleanName(couple?.[2]);
  return {
    firstName,
    lastName,
    partnerName: rawPartner === firstName ? null : rawPartner,
  };
}

export function prefillFromText(raw: string): ProjectPrefill {
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
    ...extractNames(text),
  };
}
