import { clockMinutes, clockOf, minutesClock } from "./day-clock";
import type { DayPlan, PlanRow } from "./day-plan";
import type { JobKind } from "@/features/job-kinds/job-kinds";

/**
 * A DJ's night, laid out from the couple's times (docs/vendor-journeys.md).
 *
 * The photographer's day (day-plan.ts) is built around getting ready, the
 * first look and family photos. A DJ's is the ceremony music and the
 * reception's running order: grand entrance, first dance, dinner, toasts,
 * parent dances, cake, open dancing, last dance, send-off — the order from
 * the research, anchored on the times the couple gave on their Music &
 * moments planner (or an event details form). Every line is marked as
 * suggested unless the couple gave its time, and every line is the DJ's to
 * move. Returned as a DayPlan, so the editor turns it into lines exactly as it
 * does a day.
 *
 * Pure.
 */

const KEYS = {
  ceremony: ["ceremony-time", "ceremony-run-time", "ceremonyTime"],
  cocktail: ["cocktail-hour-time", "cocktail-run-time", "cocktail-hour", "cocktail-time", "cocktailTime"],
  reception: ["reception-time", "entrances-time", "receptionTime"],
  dinner: ["dinner-time", "dinnerTime"],
  cake: ["cake-cutting-time", "cake-cutting", "cakeCuttingTime"],
  // The planner's "Reception end time" (recommended-templates.ts): when the music stops.
  end: ["coverageEndTime", "coverage-end-time", "end-time", "coverageEndsAt", "reception-end-time"],
  ceremonyPlace: ["ceremony-location", "ceremony-address", "ceremonyLocation"],
  receptionPlace: ["reception-location", "reception-address", "receptionLocation", "venue-address"],
} as const;

function answer(answers: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

const clockFor = (answers: Record<string, unknown>, keys: readonly string[]) => clockOf(answer(answers, keys));

export function planNight(input: {
  answers: Record<string, unknown>;
  /** Hours booked, in minutes, for the last dance when nobody said when the night ends. */
  coverageMinutes?: number | null;
  /** The job's own venue, when the form names none. */
  venue?: string | null;
}): DayPlan {
  const answers = input.answers;
  const notes: string[] = [];
  const ceremony = clockFor(answers, KEYS.ceremony);
  const given = {
    cocktail: clockFor(answers, KEYS.cocktail),
    reception: clockFor(answers, KEYS.reception),
    dinner: clockFor(answers, KEYS.dinner),
    cake: clockFor(answers, KEYS.cake),
    end: clockFor(answers, KEYS.end),
  };
  const ceremonyPlace = answer(answers, KEYS.ceremonyPlace) || input.venue || null;
  const receptionPlace = answer(answers, KEYS.receptionPlace) || input.venue || null;

  // The anchor: the reception, or an hour and a half after the ceremony.
  const receptionMinutes = given.reception
    ? clockMinutes(given.reception)
    : ceremony
      ? clockMinutes(ceremony) + 90
      : null;
  if (receptionMinutes === null) {
    return {
      churchDay: false,
      firstLook: false,
      rows: [],
      coverageStart: null,
      coverageEnd: null,
      notes: ["Add the ceremony or reception time from their planner, then lay out the night."],
      withheld: 0,
    };
  }
  const coverageMinutes = Number(input.coverageMinutes) > 0 ? Number(input.coverageMinutes) : 300;
  const startMinutes = ceremony ? clockMinutes(ceremony) - 30 : receptionMinutes - 60;
  // A night that ends after midnight is held to the last minute of the day:
  // the editor places lines on the event date.
  const rawEnd = given.end ? clockMinutes(given.end) : startMinutes + coverageMinutes;
  const endMinutes = Math.min(rawEnd <= startMinutes ? rawEnd + 24 * 60 : rawEnd, 24 * 60 - 1);
  const dinnerMinutes = given.dinner ? clockMinutes(given.dinner) : receptionMinutes + 20;
  const cakeMinutes = given.cake ? clockMinutes(given.cake) : dinnerMinutes + 75;

  const rows: PlanRow[] = [];
  const add = (key: string, title: string, minutes: number, where: string | null, fromForm: boolean) => {
    const time = minutesClock(minutes);
    if (!time) return;
    rows.push({
      key: `rule:dj-${key}`,
      title,
      time,
      end: null,
      where,
      source: fromForm ? "form" : "usual",
      sourceLabel: fromForm ? "From their form" : "Suggested — check it",
      tbd: false,
      travelMinutes: 0,
      team: "all",
    });
  };

  if (ceremony) {
    const at = clockMinutes(ceremony);
    add("prelude", "Guests arrive — prelude music", at - 30, ceremonyPlace, false);
    add("processional", "Processional", at, ceremonyPlace, true);
    add("ceremony", "Ceremony", at + 5, ceremonyPlace, true);
    add("recessional", "Recessional", at + 25, ceremonyPlace, false);
    add("cocktail", "Cocktail hour", given.cocktail ? clockMinutes(given.cocktail) : at + 30, receptionPlace, Boolean(given.cocktail));
  } else {
    add("cocktail", "Cocktail hour", given.cocktail ? clockMinutes(given.cocktail) : receptionMinutes - 60, receptionPlace, Boolean(given.cocktail));
  }
  add("grand-entrance", "Grand entrance", receptionMinutes, receptionPlace, Boolean(given.reception));
  add("first-dance", "First dance", receptionMinutes + 10, receptionPlace, false);
  add("welcome", "Welcome and blessing", receptionMinutes + 15, receptionPlace, false);
  add("dinner", "Dinner", dinnerMinutes, receptionPlace, Boolean(given.dinner));
  add("toasts", "Toasts and speeches", dinnerMinutes + 45, receptionPlace, false);
  add("parent-dances", "Parent dances", dinnerMinutes + 65, receptionPlace, false);
  add("cake", "Cake cutting", cakeMinutes, receptionPlace, Boolean(given.cake));
  add("open-dancing", "Open dancing", cakeMinutes + 10, receptionPlace, false);
  add("bouquet-garter", "Bouquet and garter", Math.max(cakeMinutes + 70, endMinutes - 60), receptionPlace, false);
  add("last-dance", "Last dance", endMinutes - 15, receptionPlace, false);
  add("send-off", "Send-off", endMinutes - 10, receptionPlace, false);

  rows.sort((left, right) => clockMinutes(left.time) - clockMinutes(right.time));
  if (!given.end) notes.push(`The night ends at ${minutesClock(endMinutes)}, from the hours booked — change the last dance if it's different.`);
  return {
    churchDay: false,
    firstLook: false,
    rows,
    coverageStart: minutesClock(startMinutes),
    coverageEnd: minutesClock(endMinutes),
    notes,
    withheld: 0,
  };
}

/** The moments a DJ adds by hand, in the order a reception runs. */
export const DJ_MOMENTS: ReadonlyArray<{ label: string; title: string; minutes: number }> = [
  { label: "Processional", title: "Processional", minutes: 5 },
  { label: "Recessional", title: "Recessional", minutes: 5 },
  { label: "Grand entrance", title: "Grand entrance", minutes: 10 },
  { label: "First dance", title: "First dance", minutes: 5 },
  { label: "Toasts", title: "Toasts and speeches", minutes: 20 },
  { label: "Parent dances", title: "Parent dances", minutes: 10 },
  { label: "Cake cutting", title: "Cake cutting", minutes: 10 },
  { label: "Bouquet & garter", title: "Bouquet and garter", minutes: 10 },
  { label: "Last dance", title: "Last dance", minutes: 5 },
  { label: "Send-off", title: "Send-off", minutes: 10 },
];

/**
 * A DJ's moments for a kind of job (job-kinds.ts). Only the wedding's exist
 * so far, and every kind reads them, as it always has; a kind with its own
 * night adds a row here.
 */
const DJ_MOMENTS_BY_KIND: Readonly<Partial<Record<JobKind, typeof DJ_MOMENTS>>> = {
  wedding: DJ_MOMENTS,
  // A mitzvah's party (docs/mitzvah-journey-plan-2026-10-14.md, Phase 4),
  // titled so the MC script finds each line's song and announcement.
  mitzvah: [
    { label: "Grand entrance", title: "Grand entrance", minutes: 5 },
    { label: "Hora", title: "Hora", minutes: 15 },
    { label: "Blessings", title: "Blessings over the challah and wine", minutes: 10 },
    { label: "Speeches", title: "Parents' speech and toast", minutes: 15 },
    { label: "Candle lighting", title: "Candle lighting", minutes: 30 },
    { label: "Montage", title: "Montage", minutes: 10 },
    { label: "Games", title: "Kids' games", minutes: 20 },
    { label: "Cake", title: "Cake", minutes: 10 },
    { label: "Last dance", title: "Last dance", minutes: 5 },
  ],
  // A quinceañera's reception (docs/new-job-kinds-execution-plan-2026-10-15.md,
  // Phase 1), titled so the MC script finds each line's song and announcement.
  quince: [
    { label: "Grand entrance", title: "Grand entrance of the court", minutes: 10 },
    { label: "Changing of the shoes", title: "Changing of the shoes", minutes: 10 },
    { label: "Crowning", title: "Crowning", minutes: 10 },
    { label: "Last doll", title: "The last doll", minutes: 10 },
    { label: "Waltz", title: "The waltz", minutes: 10 },
    { label: "Court's waltz", title: "The court's waltz", minutes: 10 },
    { label: "Toast", title: "The toast", minutes: 15 },
    { label: "Surprise dance", title: "Surprise dance", minutes: 10 },
    { label: "Cake", title: "Cake", minutes: 10 },
    { label: "Last dance", title: "Last dance", minutes: 5 },
  ],
  // A Sweet 16's party (Phase 2), titled for the MC script.
  sweet16: [
    { label: "Grand entrance", title: "Grand entrance", minutes: 5 },
    { label: "Candle lighting", title: "Candle lighting", minutes: 30 },
    { label: "Parent dance", title: "Parent dance", minutes: 5 },
    { label: "Toast", title: "The toast", minutes: 10 },
    { label: "Games", title: "Dancing and games", minutes: 60 },
    { label: "Cake", title: "Cake", minutes: 10 },
    { label: "Last dance", title: "Last dance", minutes: 5 },
  ],
};

export function djMomentsFor(kind: JobKind): typeof DJ_MOMENTS {
  return DJ_MOMENTS_BY_KIND[kind] ?? DJ_MOMENTS;
}
