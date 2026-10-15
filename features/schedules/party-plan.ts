import { clockMinutes, clockOf, minutesClock } from "./day-clock";
import type { DayPlan, PlanRow, PlanSource, Team } from "./day-plan";

/**
 * A celebration's day, laid out from what the family told the studio, for
 * any kind whose evening runs from a party start (docs/new-job-kinds-execution-plan-2026-10-15.md):
 * a quinceañera's (quince-plan.ts), a Sweet 16's (sweet16-plan.ts). The kind
 * gives a spec — its lines, their form ids, their usual place from the
 * start — and this lays the day out the same way for each:
 *   1. the family's own time for a line on the Final schedule form;
 *   2. its usual place in the evening, counted from the start.
 * A service before the party (a quinceañera's Mass) is on the plan only when
 * its time was given, with the house of worship's photo rules as notes.
 *
 * No timing rules, no AI. Pure: no I/O, no clock.
 */

export type PartySpec<K extends string> = {
  /** Row keys are `${prefix}:${line}`. */
  prefix: string;
  /** Every line, in its order on the day. Must include "arrive", "cake" and "last_dance". */
  titles: Record<K, string>;
  /** The family's own time for each line, by the form's question ids. */
  answerKeys: Record<K, readonly string[]>;
  /** When each placed line usually starts, in minutes from the start, and how long it runs. */
  usual: Partial<Record<K, { at: number; length: number }>>;
  /** The lines placed from `usual` (and the form), in order. Includes the anchor. */
  evening: readonly K[];
  /** The line whose time is the day's start: the cocktail hour. */
  anchor: K;
  /** What the start is, for the note when there's none: "reception", "party". */
  startName: string;
  /** Where the party is, by the form's question ids. */
  placeKeys: readonly string[];
  /** A service before the party, when the kind has one. */
  service?: {
    key: K;
    placeKeys: readonly string[];
    rulesKeys: readonly string[];
    /** Its title when no cameras are allowed. */
    noneTitle: string;
    noneNote: string;
    windowNote: string;
    /** How long it usually runs, in minutes. */
    length: number;
  };
  /** Ends of coverage, by the form's question ids. */
  coverageEndKeys: readonly string[];
  /** Hours of coverage from the start when neither the form nor the booking says. */
  defaultHours: number;
  /** A second team takes this line (the cocktail hour) when booked. */
  secondTeamLine?: K;
  /** Lines a DJ is at none of: the crew's arrival, portraits, the service. */
  notForTheDj: readonly K[];
};

const HOURS: Record<number, string> = { 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight" };
const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isTbd = (value: string) => /^\s*(tbd|tbc|to be (decided|determined|confirmed))\s*$/i.test(value);

/** The first real answer under any key; "TBD" only when nothing real is there. */
export function partyAnswer(answers: Record<string, unknown>, keys: readonly string[]): string {
  let undecided = "";
  for (const key of keys) {
    const target = norm(key);
    for (const value of [answers[key], Object.entries(answers).find(([candidate]) => norm(candidate) === target)?.[1]]) {
      if (typeof value !== "string" || !value.trim()) continue;
      if (!isTbd(value)) return value.trim();
      undecided ||= value.trim();
    }
  }
  return undecided;
}

function clockAnswer(value: string): string | null {
  const iso = /T(\d{2}:\d{2})/.exec(value);
  return iso ? iso[1]! : clockOf(value);
}

/**
 * Whether a house of worship lets cameras into its service: "none" keeps them
 * out, "window" allows photos only before or after (or from the back), and
 * "allowed" covers it. Null when the family hasn't said.
 */
export function servicePhotoRules(answers: Record<string, unknown>, keys: readonly string[]): "none" | "window" | "allowed" | null {
  const value = partyAnswer(answers, keys).toLowerCase();
  if (!value || isTbd(value)) return null;
  if (/^no\b|none|not allowed|no photo/.test(value)) return "none";
  if (/window|before|after|only|from the back|no flash/.test(value)) return "window";
  if (/yes|allowed|fine|ok/.test(value)) return "allowed";
  return null;
}

export type PartyInput = {
  answers: Record<string, unknown>;
  /** Hours on the booking, in minutes, for where coverage ends when nobody said. */
  coverageMinutes?: number | null;
  /** The job's own venue, when the form names none. */
  venue?: string | null;
  /** A second photo/video team is booked. */
  secondTeam?: boolean;
  /** Only what the family gave (and their TBDs), no suggested lines. */
  answeredOnly?: boolean;
};

export function planPartyDay<K extends string>(spec: PartySpec<K>, input: PartyInput): DayPlan {
  const answers = input.answers;
  const notes: string[] = [];
  const partyPlace = partyAnswer(answers, spec.placeKeys) || input.venue || null;
  const servicePlace = spec.service ? partyAnswer(answers, spec.service.placeKeys) || null : null;

  const start = clockAnswer(partyAnswer(answers, spec.answerKeys[spec.anchor]));
  if (!start) {
    return {
      churchDay: false,
      firstLook: false,
      rows: [],
      coverageStart: null,
      coverageEnd: null,
      notes: [`There's no ${spec.startName} start time yet. The day is laid out from it once the family gives one.`],
      withheld: 0,
    };
  }
  const S = clockMinutes(start);

  type Placed = { minutes: number; source: PlanSource; label: string; tbd: boolean };
  const placed = new Map<K, Placed>();
  const fromForm = (key: K): Placed | "tbd" | null => {
    const value = partyAnswer(answers, spec.answerKeys[key]);
    if (!value) return null;
    if (isTbd(value)) return "tbd";
    const clock = clockAnswer(value);
    return clock ? { minutes: clockMinutes(clock), source: "form", label: "From their form", tbd: false } : null;
  };
  for (const key of spec.evening) {
    const answered = fromForm(key);
    if (answered && answered !== "tbd") {
      placed.set(key, answered);
      continue;
    }
    placed.set(key, {
      minutes: S + spec.usual[key]!.at,
      source: "usual",
      label: answered === "tbd" ? "Their form: TBD" : "Suggested — check it",
      tbd: answered === "tbd",
    });
  }

  // The service only when they gave its time, and only before the party.
  const rules = spec.service ? servicePhotoRules(answers, spec.service.rulesKeys) : null;
  if (spec.service) {
    const service = fromForm(spec.service.key);
    if (service && service !== "tbd" && service.minutes < S) placed.set(spec.service.key, service);
    if (rules === "none") notes.push(spec.service.noneNote);
    if (rules === "window") notes.push(spec.service.windowNote);
  }

  // Coverage: their times, else the booking's hours from the first line, else the kind's default.
  const earliest = Math.min(...[...placed.values()].map((at) => at.minutes));
  const arriveKey = "arrive" as K;
  const arriveAnswer = fromForm(arriveKey);
  const arrive: Placed = arriveAnswer && arriveAnswer !== "tbd"
    ? arriveAnswer
    : { minutes: earliest, source: "coverage", label: "Starts with the first thing on the day", tbd: false };
  placed.set(arriveKey, arrive);
  const endAnswer = clockAnswer(partyAnswer(answers, spec.coverageEndKeys));
  const booked = input.coverageMinutes && input.coverageMinutes > 0 ? input.coverageMinutes : null;
  const end = endAnswer ? clockMinutes(endAnswer) : booked ? arrive.minutes + booked : S + spec.defaultHours * 60;
  if (!endAnswer && !booked) {
    notes.push(`No coverage hours on the booking: the day ends ${HOURS[spec.defaultHours] ?? String(spec.defaultHours)} hours after the ${spec.startName} starts.`);
  }

  for (const [key, before] of [["cake" as K, 45], ["last_dance" as K, 15]] as const) {
    const answered = fromForm(key);
    placed.set(
      key,
      answered && answered !== "tbd"
        ? answered
        : { minutes: end - before, source: "usual", label: answered === "tbd" ? "Their form: TBD" : "Suggested — check it", tbd: answered === "tbd" },
    );
  }

  const serviceKey = spec.service?.key;
  const whereFor = (key: K): string | null => (key === serviceKey ? servicePlace : partyPlace);
  const teamFor = (key: K): Team => (input.secondTeam && key === spec.secondTeamLine ? "second" : "all");
  const titleFor = (key: K) => (key === serviceKey && rules === "none" ? spec.service!.noneTitle : spec.titles[key]);
  const keyOf = (row: PlanRow) => String(row.key).slice(spec.prefix.length + 1) as K;

  const order = Object.keys(spec.titles) as K[];
  let rows: PlanRow[] = [];
  for (const key of order) {
    const at = placed.get(key);
    const clock = at ? minutesClock(at.minutes) : null;
    if (!at || !clock) continue;
    rows.push({
      key: `${spec.prefix}:${key}` as PlanRow["key"],
      title: titleFor(key),
      time: clock,
      end: null,
      where: whereFor(key),
      source: at.source,
      sourceLabel: at.label,
      tbd: at.tbd,
      travelMinutes: 0,
      team: teamFor(key),
    });
  }
  rows.sort((left, right) => clockMinutes(left.time) - clockMinutes(right.time) || order.indexOf(keyOf(left)) - order.indexOf(keyOf(right)));
  let withheld = 0;
  if (input.answeredOnly) {
    const kept = rows.filter((row) => !(row.source === "usual" && !row.tbd));
    withheld = rows.length - kept.length;
    rows = kept;
  }
  // A block runs to the next one, unless that would stretch it across free time.
  const sameTrack = (left: Team, right: Team) => left === "all" || right === "all" || left === right;
  rows.forEach((row, index) => {
    const key = keyOf(row);
    const natural = key === serviceKey ? spec.service!.length : (spec.usual[key]?.length ?? 15);
    const next = rows.slice(index + 1).find((later) => sameTrack(row.team, later.team) && later.time > row.time);
    if (!next) return;
    const begin = clockMinutes(row.time);
    if (clockMinutes(next.time) - begin >= natural + 30) row.end = minutesClock(begin + natural);
  });
  const early = rows.filter((row) => keyOf(row) !== arriveKey && keyOf(row) !== serviceKey && clockMinutes(row.time) < arrive.minutes);
  if (early.length) notes.push(`${early.map((row) => row.title).join(", ")} ${early.length === 1 ? "is" : "are"} before coverage starts.`);
  return {
    churchDay: false,
    firstLook: false,
    rows,
    coverageStart: minutesClock(arrive.minutes),
    coverageEnd: minutesClock(Math.min(end, 24 * 60 - 1)),
    notes,
    withheld,
  };
}

/** A DJ's night: the same evening without the lines the DJ is at none of. */
export function planPartyNight<K extends string>(spec: PartySpec<K>, input: Omit<PartyInput, "secondTeam" | "answeredOnly">): DayPlan {
  const plan = planPartyDay(spec, { ...input, secondTeam: false });
  const skip = new Set<string>(spec.notForTheDj.map((key) => `${spec.prefix}:${key}`));
  return {
    ...plan,
    rows: plan.rows.filter((row) => !skip.has(String(row.key))),
    notes: plan.notes.filter((note) => !/crew sheet|before coverage/.test(note)),
  };
}
