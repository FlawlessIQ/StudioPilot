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

export type Discrepancy = {
  field: string;
  expected: string;
  extracted: string;
  severity: "info" | "warning" | "blocking";
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** A date as YYYY-MM-DD, however it was written, or null if it isn't one. */
export function calendarDate(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // "15 May 2027", "May 15, 2027", "15 May 27" — how certificates actually read.
  const words = text
    .toLowerCase()
    .match(/(?:(\d{1,2})\s+([a-z]+)|([a-z]+)\s+(\d{1,2}))[,\s]+(\d{4})/);
  if (words) {
    const day = Number(words[1] ?? words[4]);
    const monthName = (words[2] ?? words[3] ?? "").slice(0, 3);
    const month = MONTHS.findIndex((name) => name.startsWith(monthName)) + 1;
    if (month > 0 && day >= 1 && day <= 31)
      return `${words[5]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const slashed = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  // Ambiguous by nature; US order, because that is what the certificates say.
  if (slashed)
    return `${slashed[3]}-${String(Number(slashed[1])).padStart(2, "0")}-${String(Number(slashed[2])).padStart(2, "0")}`;
  return null;
}

/** Whether two written dates are the same day. Unreadable dates never match. */
export function sameCalendarDate(left: unknown, right: unknown): boolean {
  const a = calendarDate(left);
  const b = calendarDate(right);
  return a !== null && b !== null && a === b;
}

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
