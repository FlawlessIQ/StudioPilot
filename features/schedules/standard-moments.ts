/**
 * The standard moments of a wedding day, one tap each.
 *
 * GR Productions (2026-10-01) wanted quick adds for the moments every wedding
 * has — details, getting into the dress, first look, portraits, family and
 * bridal party, cocktail hour, dinner, cake cutting — instead of typing each
 * one into a blank row and setting two clocks.
 *
 * Each lands at a sensible default time worked out from what is already
 * known: the ceremony (an item called "Ceremony" on the page, or the time in
 * the form), the reception, the coverage window, and any of these times the
 * couple gave on their form. Nothing is guessed beyond that: with no anchor
 * the moment goes after the last item, and the studio sets the time. The list
 * then re-sorts (features/schedules/run-of-show-order.ts).
 *
 * The same list, in the same order, is handed to the AI as the standard
 * moments to include when they fit (functions/src/ai/schedule-moments.ts —
 * tests/run-of-show-order.test.ts fails on drift).
 *
 * Pure, no I/O.
 */

import { nextItemStart } from "@/features/planning/manual-run-of-show";

export type StandardMomentKey =
  | "details"
  | "dress"
  | "first_look"
  | "ceremony"
  | "family"
  | "portraits"
  | "cocktail"
  | "reception"
  | "dinner"
  | "cake";

export type StandardMoment = {
  key: StandardMomentKey;
  /** The chip. */
  label: string;
  /** The item it adds. */
  title: string;
  minutes: number;
};

/** In the order a wedding day usually runs. */
export const WEDDING_STANDARD_MOMENTS: readonly StandardMoment[] = [
  { key: "details", label: "Details", title: "Details", minutes: 30 },
  { key: "dress", label: "Getting into the dress", title: "Getting into the dress", minutes: 30 },
  { key: "first_look", label: "First look", title: "First look", minutes: 20 },
  { key: "ceremony", label: "Ceremony", title: "Ceremony", minutes: 30 },
  { key: "family", label: "Family & bridal party", title: "Family and bridal party photos", minutes: 30 },
  { key: "portraits", label: "Couple portraits", title: "Couple portraits", minutes: 30 },
  { key: "cocktail", label: "Cocktail hour", title: "Cocktail hour", minutes: 60 },
  { key: "reception", label: "Reception", title: "Reception", minutes: 30 },
  { key: "dinner", label: "Dinner", title: "Dinner", minutes: 60 },
  { key: "cake", label: "Cake cutting", title: "Cake cutting", minutes: 15 },
];

/** Times already known, as anything `Date` can read (ISO or datetime-local). */
export type MomentAnchors = {
  coverageStartsAt?: string | null;
  coverageEndsAt?: string | null;
  ceremonyAt?: string | null;
  receptionAt?: string | null;
  /** From the couple's form when the studio's questionnaire asks. */
  firstLookAt?: string | null;
  cocktailAt?: string | null;
  dinnerAt?: string | null;
  cakeAt?: string | null;
};

const MINUTE = 60_000;

const at = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const plus = (base: number | null, minutes: number): number | null =>
  base === null ? null : base + minutes * MINUTE;

/** The first item whose title names this moment, e.g. "Ceremony". */
const itemNamed = (
  items: readonly { title?: string; startAt: string; endAt: string }[],
  pattern: RegExp,
) => items.find((item) => pattern.test(String(item.title ?? "")));

/**
 * Where a standard moment goes: its start, end and title.
 *
 * Deterministic: the same items and anchors always give the same answer.
 */
export function placeStandardMoment(
  key: StandardMomentKey,
  items: readonly { title?: string; startAt: string; endAt: string }[],
  anchors: MomentAnchors,
): { title: string; startAt: string; endAt: string } {
  const moment =
    WEDDING_STANDARD_MOMENTS.find((candidate) => candidate.key === key) ??
    (WEDDING_STANDARD_MOMENTS[0] as StandardMoment);

  // What is on the page wins over the form: the studio may have retimed it.
  const ceremonyItem = itemNamed(items, /\bceremony\b/i);
  const receptionItem = itemNamed(items, /\breception\b/i);
  const coverageStart = at(anchors.coverageStartsAt);
  const ceremonyStart = at(ceremonyItem?.startAt) ?? at(anchors.ceremonyAt);
  const ceremonyItemEnd = at(ceremonyItem?.endAt);
  // Its own end, unless that is not really a ceremony's length: a hand-started
  // draft runs each item up to the next (seededManualSchedule), so a
  // "Ceremony" there can span the two hours to the reception.
  const ceremonyEnd =
    ceremonyItemEnd !== null &&
    ceremonyStart !== null &&
    ceremonyItemEnd > ceremonyStart &&
    ceremonyItemEnd - ceremonyStart <= 90 * MINUTE
      ? ceremonyItemEnd
      : plus(ceremonyStart, 30);
  // No reception time: it usually follows an hour of cocktails.
  const receptionStart =
    at(receptionItem?.startAt) ?? at(anchors.receptionAt) ?? plus(ceremonyEnd, 60);
  const dinnerStart = at(anchors.dinnerAt) ?? plus(receptionStart, 30);

  const start: number | null = (() => {
    switch (moment.key) {
      case "details":
        return coverageStart ?? plus(ceremonyStart, -150);
      case "dress":
        return plus(ceremonyStart, -90) ?? plus(coverageStart, 60);
      case "first_look":
        return at(anchors.firstLookAt) ?? plus(ceremonyStart, -60);
      case "ceremony":
        return at(anchors.ceremonyAt);
      case "family":
        return ceremonyEnd;
      case "portraits":
        return plus(ceremonyEnd, 30);
      case "cocktail":
        return at(anchors.cocktailAt) ?? ceremonyEnd;
      case "reception":
        return at(anchors.receptionAt) ?? receptionStart;
      case "dinner":
        return dinnerStart;
      case "cake":
        return at(anchors.cakeAt) ?? plus(dinnerStart, 60);
    }
  })();

  // Nobody is there to photograph it before coverage starts.
  const clamped =
    start !== null && coverageStart !== null && start < coverageStart ? coverageStart : start;
  const startMs =
    clamped ?? Date.parse(nextItemStart(items, anchors.coverageStartsAt ?? null));
  return {
    title: moment.title,
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + moment.minutes * MINUTE).toISOString(),
  };
}

/**
 * Whether a job is a wedding, for offering the wedding moments.
 *
 * Unknown reads as a wedding, as the AI draft does: it is the default event
 * type and by far the most common.
 */
export function isWeddingJob(project: Record<string, unknown> | null | undefined): boolean {
  const type = String(project?.eventTypeId ?? project?.eventType ?? "").trim();
  return !type || /wedding|elopement/i.test(type);
}
