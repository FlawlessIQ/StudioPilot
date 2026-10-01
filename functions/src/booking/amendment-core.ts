/**
 * Changing a booking after the couple signed: the pure half.
 *
 * A signed wedding used to be frozen. Packages locked at signing, an accepted
 * proposal was final, a signed contract could not be voided and a new one
 * could only be prepared before booking — so a couple who wanted video added,
 * or their date moved, left the studio with no way forward inside StudioCue.
 *
 * An amendment is the way forward. The studio changes the packages, their
 * extras (or writes a one-off package) and/or the date; the couple signs one document that says what changes and restates the
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

/** Minutes a zone is ahead of UTC at one instant (e.g. -240 for New York in summer). */
function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * An ISO timestamp moved by whole days, keeping its local clock time in
 * `timeZone` — a 3 PM call stays at 3 PM across a daylight-saving change,
 * where adding 24-hour days would land it at 2 or 4. An unknown zone falls
 * back to whole UTC days.
 */
export function shiftInZone(value: unknown, days: number, timeZone: string | null | undefined): unknown {
  if (typeof value !== "string" || !days) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  const moved = ms + days * 86_400_000;
  if (!timeZone) return new Date(moved).toISOString();
  try {
    const delta = zoneOffsetMinutes(ms, timeZone) - zoneOffsetMinutes(moved, timeZone);
    return new Date(moved + delta * 60_000).toISOString();
  } catch {
    return new Date(moved).toISOString();
  }
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

/** "Saturday, June 12, 2027". */
export const longDate = (value: string) =>
  ISO_DATE.test(value)
    ? new Date(`${value}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : value;

/** What a consultation is called in a sentence to the couple. */
export function consultationLabel(mode: unknown): string {
  return mode === "zoom" ? "Zoom call" : mode === "phone" ? "phone call" : mode === "in_person" ? "meeting" : "consultation";
}

/** "Tuesday, June 8 at 3:00 PM", in the consultation's own timezone. */
export function consultationWhen(startsAt: string, timezone: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.valueOf())) return startsAt;
  const zone = (() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();
  const day = date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: zone });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day} at ${time}`;
}

/** Whether two time ranges share any moment (touching ends don't count). */
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const [a0, a1, b0, b1] = [aStart, aEnd, bStart, bEnd].map((value) => Date.parse(value));
  if ([a0, a1, b0, b1].some((value) => Number.isNaN(value))) return false;
  return a0! < b1! && b0! < a1!;
}

export type MovedCall = { label: string; from: string; to: string };

/** One extra, as a change line names it. */
export type ExtraLine = { addOnId: string; name: string; quantity: number; lineTotalCents: number };

/** What changed among the extras on one package. */
export type ExtrasChange = {
  packageName: string;
  added: ExtraLine[];
  removed: ExtraLine[];
  /** The same extra, a different number of it. */
  changed: Array<{ name: string; fromQuantity: number; toQuantity: number; lineTotalCents: number }>;
};

/**
 * The extras on a package before and after a change, compared by extra (the
 * same extra listed twice counts as one, with the quantities summed).
 */
export function extrasChange(packageName: string, before: readonly ExtraLine[], after: readonly ExtraLine[]): ExtrasChange {
  const tally = (lines: readonly ExtraLine[]) => {
    const map = new Map<string, ExtraLine>();
    for (const line of lines) {
      const key = line.addOnId || `name:${line.name}`;
      const seen = map.get(key);
      map.set(
        key,
        seen
          ? { ...seen, quantity: seen.quantity + line.quantity, lineTotalCents: seen.lineTotalCents + line.lineTotalCents }
          : { ...line },
      );
    }
    return map;
  };
  const was = tally(before);
  const now = tally(after);
  const change: ExtrasChange = { packageName, added: [], removed: [], changed: [] };
  for (const [key, line] of now) {
    const previous = was.get(key);
    if (!previous) change.added.push(line);
    else if (previous.quantity !== line.quantity)
      change.changed.push({
        name: line.name,
        fromQuantity: previous.quantity,
        toQuantity: line.quantity,
        lineTotalCents: line.lineTotalCents,
      });
  }
  for (const [key, line] of was) if (!now.has(key)) change.removed.push(line);
  return change;
}

/** What changes, in the words the couple and the studio both read. */
export function amendmentChangeLines(input: {
  previousDate: string;
  newDate: string;
  keptPackages: string[];
  addedPackages: string[];
  removedPackages: string[];
  money: AmendmentMoney;
  currency?: string;
  /** Consultations the studio is moving with the date. */
  movedCalls?: MovedCall[];
  /** Packages written for this couple only, added by the change (price before tax). */
  addedOneOffs?: Array<{ name: string; priceCents: number }>;
  /** Extras added to, removed from or changed on a package. */
  extras?: ExtrasChange[];
}): string[] {
  const lines: string[] = [];
  const currency = input.currency ?? "USD";
  if (input.newDate && input.newDate !== input.previousDate)
    lines.push(`The wedding date moves from ${longDate(input.previousDate)} to ${longDate(input.newDate)}.`);
  for (const call of input.movedCalls ?? []) lines.push(`Your ${call.label} on ${call.from} moves to ${call.to}.`);
  for (const name of input.addedPackages) lines.push(`${name} is added.`);
  for (const oneOff of input.addedOneOffs ?? [])
    lines.push(`${oneOff.name} (one-off, ${dollars(oneOff.priceCents, currency)}) is added.`);
  for (const name of input.removedPackages) lines.push(`${name} is removed.`);
  for (const change of input.extras ?? []) {
    for (const extra of change.added)
      lines.push(
        `${extra.name}${extra.quantity > 1 ? ` ×${extra.quantity}` : ""} is added to ${change.packageName} (${dollars(extra.lineTotalCents, currency)}).`,
      );
    for (const extra of change.changed)
      lines.push(
        `${extra.name} on ${change.packageName} changes from ${extra.fromQuantity} to ${extra.toQuantity} (${dollars(extra.lineTotalCents, currency)}).`,
      );
    for (const extra of change.removed) lines.push(`${extra.name} is removed from ${change.packageName}.`);
  }
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
