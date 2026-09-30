/**
 * Reading a certificate against what the venue asked for.
 *
 * A studio owner decides whether a legal document is good enough, and what
 * they were shown was this:
 *
 *   certificateHolder: expected Oak Hill Barn LLC, extracted Oakhill Barn Events Inc.
 *   eventDate: expected 2027-05-15, extracted 15 May 2027
 *   requiredLimits.generalLiability: expected 200000000, extracted
 *
 * The first line is the real problem and reads like a database row. The second
 * is the same date twice, flagged as blocking, so the studio phones their agent
 * about nothing. The third is $2,000,000 written in cents against an empty
 * value, because the requirement is stored in cents and a certificate states
 * dollars — a comparison that can never pass and never says what is short.
 *
 * So: compare like for like, and say it the way a person would.
 *
 * Pure. Duplicated from features/insurance/certificate-review.ts, used by the
 * extraction worker uses; tests/certificate-review.test.ts keeps them equal.
 */

import { calendarDate, sameCalendarDate } from "./calendar-date.js";

export { calendarDate, sameCalendarDate };

export type Discrepancy = {
  field: string;
  expected: string;
  extracted: string;
  severity: "info" | "warning" | "blocking";
};

/**
 * A money amount in dollars.
 *
 * Which side is which is known at the call site — the venue's requirement is
 * stored in cents, a certificate states dollars, often with a symbol and
 * commas — so the caller says, and nothing here guesses. A first draft
 * inferred the unit from size and turned a certificate's honest $1,000,000
 * into $10,000, which is the one direction this must never be wrong in.
 */
export function limitDollars(value: unknown, storedAsCents = false): number | null {
  const raw = String(value ?? "").replace(/[$,\s]/g, "");
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return storedAsCents ? amount / 100 : amount;
}

export function formatMoney(dollars: number): string {
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

const FIELD_LABELS: Record<string, string> = {
  certificateHolder: "Certificate holder",
  eventDate: "Event date",
  coverageTypes: "Coverage",
  additionalInsuredWording: "Additional insured",
  waiverOfSubrogation: "Waiver of subrogation",
  primaryNoncontributory: "Primary and noncontributory",
  "requiredLimits.generalLiability": "General liability limit",
  "requiredLimits.damageToPremises": "Damage to rented premises",
};

export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const bare = field.replace(/^requiredLimits\./, "");
  const spaced = bare
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The one sentence a studio reads before deciding. */
export function describeDiscrepancy(discrepancy: Discrepancy): {
  label: string;
  detail: string;
  severity: Discrepancy["severity"];
} {
  const label = fieldLabel(discrepancy.field);
  const missing = !discrepancy.extracted.trim();
  if (discrepancy.field.startsWith("requiredLimits.")) {
    const required = limitDollars(discrepancy.expected, true);
    const carried = limitDollars(discrepancy.extracted);
    return {
      label,
      detail: missing || carried === null
        ? `The certificate doesn't state one. The venue requires ${required === null ? discrepancy.expected : formatMoney(required)}.`
        : `The certificate carries ${formatMoney(carried)}. The venue requires ${required === null ? discrepancy.expected : formatMoney(required)}.`,
      severity: discrepancy.severity,
    };
  }
  if (missing) {
    return {
      label,
      detail: `The certificate doesn't state this. The venue asked for "${discrepancy.expected}".`,
      severity: discrepancy.severity,
    };
  }
  return {
    label,
    detail: `The certificate says "${discrepancy.extracted}". The venue asked for "${discrepancy.expected}".`,
    severity: discrepancy.severity,
  };
}

/**
 * Whether a stored discrepancy is still a disagreement.
 *
 * Discrepancies are frozen onto the request when the certificate is read, so a
 * comparison fixed today does nothing for the ones already on file: a studio
 * kept being shown "the certificate says 15 May 2027, the venue asked for
 * 2027-05-15" — one date, twice — long after the extractor stopped producing
 * it. Reading them back through the same rules retires those without a
 * migration, and leaves every real disagreement standing.
 */
export function stillDisagrees(discrepancy: Discrepancy): boolean {
  if (discrepancy.field === "certificateHolder")
    return !holderMatches(discrepancy.expected, discrepancy.extracted);
  if (discrepancy.field === "coverageTypes")
    return !coverageMatches(discrepancy.expected, discrepancy.extracted.split(/,\s*/));
  if (discrepancy.field === "eventDate")
    return !sameCalendarDate(discrepancy.expected, discrepancy.extracted);
  if (discrepancy.field.startsWith("requiredLimits.")) {
    const required = limitDollars(discrepancy.expected, true);
    const carried = limitDollars(discrepancy.extracted);
    if (required === null) return true;
    return carried === null || carried < required;
  }
  return true;
}

/** Letters and digits only, so "Harvard College," and "harvard college" agree. */
function plain(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Whether the certificate names the holder the venue asked for.
 *
 * A certificate's holder box is the name followed by the address, and the
 * extractor returns the box as written: "President and Fellows of Harvard
 * College Arnold Arboretum, 125 Arborway, Boston" against a requirement of
 * "President and Fellows of Harvard College" was flagged as blocking, on a
 * correct certificate (walked 2026-09-30). The name must lead the box; a
 * different entity ("Oakhill Barn Events Inc." for "Oak Hill Barn LLC") still
 * disagrees.
 */
export function holderMatches(expected: unknown, extracted: unknown): boolean {
  const want = plain(expected);
  const got = plain(extracted);
  if (!want) return true;
  return got === want || got.startsWith(`${want} `);
}

const COVERAGE_ALIASES: Array<[RegExp, string]> = [
  [/\b(cgl|gl)\b/g, "general liability"],
  [/\bauto\b/g, "automobile"],
  [/\bwc\b/g, "workers compensation"],
  [/\bworkers comp\b/g, "workers compensation"],
];

function coverageWords(value: unknown): string {
  let words = plain(value).replace(/\bworker s\b/g, "workers");
  for (const [pattern, replacement] of COVERAGE_ALIASES) words = words.replace(pattern, replacement);
  return ` ${words} `;
}

/**
 * Whether a certificate's coverage lines include what the venue asked for.
 *
 * ACORD certificates print "COMMERCIAL GENERAL LIABILITY"; venues write
 * "General liability". An exact compare flagged that as missing cover, as
 * blocking. A line counts when it contains the asked-for words in order.
 */
export function coverageMatches(expected: unknown, extracted: unknown[]): boolean {
  const want = coverageWords(expected);
  if (!want.trim()) return true;
  return extracted.some((line) => coverageWords(line).includes(want));
}
