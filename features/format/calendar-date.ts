/**
 * A date as a person wrote it, read back as a calendar day.
 *
 * Two places need this and neither gets to choose the wording. A certificate of
 * insurance states "15 May 2027" where the venue's requirement is stored as
 * "2027-05-15", and a gallery provider writes "Downloads expire: 20 December
 * 2026" or "available until December 20, 2026" where the form wants a date
 * input. Both had readers that accepted only digits, so both quietly reported
 * nothing: the certificate flagged one day against itself as a discrepancy, and
 * the delivery form left the expiration blank under a panel promising it had
 * been extracted.
 *
 * Pure, and deliberately not a date library — the inputs are short, human, and
 * few. Duplicated at functions/src/operations/calendar-date.ts;
 * tests/calendar-date.test.ts keeps the copies equal.
 */

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
  // "15 May 2027", "May 15, 2027", "20 December 2026" — how people write dates.
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
  // Ambiguous by nature; US order, because that is what these documents use.
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
