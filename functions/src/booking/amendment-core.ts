/**
 * Changing a booking after the couple signed: the pure half.
 *
 * A signed wedding used to be frozen. Packages locked at signing, an accepted
 * proposal was final, a signed contract could not be voided and a new one
 * could only be prepared before booking — so a couple who wanted video added,
 * or their date moved, left the studio with no way forward inside StudioCue.
 *
 * An amendment is the way forward. The studio changes the packages and/or the
 * date; the couple signs one document that says what changes and restates the
 * whole agreement; the job never leaves its stage, and the original agreement
 * stands until the change is signed. The records side is
 * functions/src/contracts/amendments.ts (studio commands) and
 * functions/src/booking/amendment-apply.ts (what signing changes).
 *
 * Money rules, deliberately few:
 * - the retainer is what was agreed; a change never re-prices it;
 * - payments already made are kept and credited;
 * - the new total less the retainer is the new final balance;
 * - money owed back is a refund for the studio to make, never a negative bill.
 */

/** A job can be changed this way once its agreement is signed. */
export const AMENDABLE_STATES = [
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "POSTPONED",
] as const;

export function isAmendableState(state: unknown): boolean {
  return (AMENDABLE_STATES as readonly string[]).includes(String(state ?? ""));
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from one calendar date to another (UTC, so no DST drift). */
export function daysBetween(from: string, to: string): number {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A calendar date moved by whole days. */
export function shiftDate(value: string, days: number): string {
  if (!ISO_DATE.test(value)) return value;
  const next = new Date(`${value}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** An ISO timestamp moved by whole days, keeping its clock time. */
export function shiftTimestamp(value: unknown, days: number): unknown {
  if (typeof value !== "string" || !days) return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed + days * 86_400_000).toISOString();
}

export type AmendmentMoney = {
  previousTotalCents: number;
  newTotalCents: number;
  retainerCents: number;
  paidCents: number;
  /** The new final balance as the schedule states it. */
  finalBalanceCents: number;
  /** What is still to be paid after this change, never negative. */
  outstandingCents: number;
  /** Paid beyond the new total: a refund the studio owes. */
  refundCents: number;
};

export function amendmentMoney(input: {
  previousTotalCents: number;
  newTotalCents: number;
  agreedRetainerCents: number;
  paidCents: number;
}): AmendmentMoney {
  const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);
  const newTotalCents = whole(input.newTotalCents);
  const retainerCents = Math.min(whole(input.agreedRetainerCents), newTotalCents);
  const paidCents = whole(input.paidCents);
  return {
    previousTotalCents: whole(input.previousTotalCents),
    newTotalCents,
    retainerCents,
    paidCents,
    finalBalanceCents: Math.max(0, newTotalCents - retainerCents),
    outstandingCents: Math.max(0, newTotalCents - paidCents),
    refundCents: Math.max(0, paidCents - newTotalCents),
  };
}

const dollars = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const longDate = (value: string) =>
  ISO_DATE.test(value)
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : value;

/** What changes, in the words the couple and the studio both read. */
export function amendmentChangeLines(input: {
  previousDate: string;
  newDate: string;
  keptPackages: string[];
  addedPackages: string[];
  removedPackages: string[];
  money: AmendmentMoney;
  currency?: string;
}): string[] {
  const lines: string[] = [];
  const currency = input.currency ?? "USD";
  if (input.newDate && input.newDate !== input.previousDate)
    lines.push(`The wedding date moves from ${longDate(input.previousDate)} to ${longDate(input.newDate)}.`);
  for (const name of input.addedPackages) lines.push(`${name} is added.`);
  for (const name of input.removedPackages) lines.push(`${name} is removed.`);
  if (input.money.newTotalCents !== input.money.previousTotalCents)
    lines.push(
      `The total changes from ${dollars(input.money.previousTotalCents, currency)} to ${dollars(input.money.newTotalCents, currency)}.`,
    );
  if (input.money.paidCents > 0)
    lines.push(`${dollars(input.money.paidCents, currency)} already paid is kept and counts toward the new total.`);
  if (input.money.refundCents > 0)
    lines.push(`${dollars(input.money.refundCents, currency)} paid beyond the new total will be refunded.`);
  else if (input.money.newTotalCents !== input.money.previousTotalCents || input.money.paidCents > 0)
    lines.push(`${dollars(input.money.outstandingCents, currency)} remains to be paid.`);
  if (!lines.length) lines.push("Nothing about the booking changes.");
  return lines;
}
