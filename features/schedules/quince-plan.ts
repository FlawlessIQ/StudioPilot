import { clockMinutes, clockOf, minutesClock } from "./day-clock";
import type { DayPlan, PlanRow, PlanSource, Team } from "./day-plan";

/**
 * A quinceañera's day, laid out from what the family told the studio
 * (docs/new-job-kinds-execution-plan-2026-10-15.md, Phase 1).
 *
 * The reception is the anchor, as the party is a mitzvah's: its start is when
 * the cocktail hour opens, and the evening runs in the usual order from there
 * — the court's grand entrance, the changing of the shoes, the crowning, the
 * last doll, the waltz with her father, the court's waltz, the toast, dinner,
 * the surprise dance, dancing, cake, the last dance. Before it, portraits with
 * the court and family. Each line comes from, in order:
 *   1. the family's own time for it on the Final schedule form;
 *   2. its usual place in the evening, counted from the reception's start.
 *
 * The Mass is the parish's: it is on the plan when the family gave its time,
 * and says when the parish keeps cameras out. The portrait session weeks
 * before is its own job (Conor, 2026-10-15), never on this plan.
 *
 * No timing rules: built from the form alone, like the wedding's and the
 * mitzvah's. Pure: no I/O, no clock.
 */

export type QuinceMilestone =
  | "arrive"
  | "mass"
  | "family_portraits"
  | "cocktail"
  | "entrance"
  | "shoes"
  | "crowning"
  | "last_doll"
  | "waltz"
  | "court_waltz"
  | "toast"
  | "dinner"
  | "surprise_dance"
  | "dancing"
  | "cake"
  | "last_dance";

const TITLES: Record<QuinceMilestone, string> = {
  arrive: "Photo and video arrive",
  mass: "Mass",
  family_portraits: "Portraits with the court and family",
  cocktail: "Cocktail hour",
  entrance: "Grand entrance of the court",
  shoes: "Changing of the shoes",
  crowning: "Crowning",
  last_doll: "The last doll",
  waltz: "The waltz",
  court_waltz: "The court's waltz",
  toast: "The toast",
  dinner: "Dinner",
  surprise_dance: "Surprise dance",
  dancing: "Dancing",
  cake: "Cake",
  last_dance: "Last dance",
};

/** The family's own time for a line, by the Final schedule form's question ids. */
export const QUINCE_ANSWER_KEYS: Record<QuinceMilestone, readonly string[]> = {
  arrive: ["coverageStartTime", "coverage-start-time", "photographyStartTime"],
  mass: ["mass-time"],
  family_portraits: ["family-portraits-time"],
  cocktail: ["reception-start-time", "party-start-time", "cocktail-hour-time"],
  entrance: ["grand-entrance-time"],
  shoes: ["shoes-time"],
  crowning: ["crowning-time"],
  last_doll: ["last-doll-time"],
  waltz: ["waltz-time"],
  court_waltz: ["court-waltz-time"],
  toast: ["toast-time"],
  dinner: ["dinner-time"],
  surprise_dance: ["surprise-dance-time"],
  dancing: ["dancing-time"],
  cake: ["cake-time", "cake-cutting-time"],
  last_dance: ["last-dance-time"],
};

/** When each line usually starts, in minutes from the reception's start, and how long it runs. */
const USUAL: Partial<Record<QuinceMilestone, { at: number; length: number }>> = {
  family_portraits: { at: -90, length: 60 },
  cocktail: { at: 0, length: 60 },
  entrance: { at: 60, length: 10 },
  shoes: { at: 70, length: 10 },
  crowning: { at: 80, length: 10 },
  last_doll: { at: 90, length: 10 },
  waltz: { at: 100, length: 10 },
  court_waltz: { at: 110, length: 10 },
  toast: { at: 120, length: 15 },
  dinner: { at: 135, length: 60 },
  surprise_dance: { at: 195, length: 10 },
  dancing: { at: 205, length: 60 },
};

/** The evening's lines, in their usual order (everything with a USUAL place). */
const EVENING = ["family_portraits", "cocktail", "entrance", "shoes", "crowning", "last_doll", "waltz", "court_waltz", "toast", "dinner", "surprise_dance", "dancing"] as const;

const COVERAGE_END_KEYS = ["coverageEndTime", "coverage-end-time", "reception-end-time", "party-end-time", "end-time"];
const MASS_RULES_KEYS = ["mass-photo-rules"];
const PLACE_KEYS = {
  mass: ["church", "mass-location"],
  reception: ["reception-location", "party-location", "venue-address"],
};

const norm = (value: unknown) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isTbd = (value: string) => /^\s*(tbd|tbc|to be (decided|determined|confirmed))\s*$/i.test(value);

/** The first real answer under any key; "TBD" only when nothing real is there. */
function answerFor(answers: Record<string, unknown>, keys: readonly string[]): string {
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
 * Whether the parish lets cameras into the Mass: "none" keeps them out,
 * "window" allows photos only before or after, "allowed" covers it. Null
 * when the family hasn't said.
 */
export function massRules(answers: Record<string, unknown>): "none" | "window" | "allowed" | null {
  const value = answerFor(answers, MASS_RULES_KEYS).toLowerCase();
  if (!value || isTbd(value)) return null;
  if (/^no\b|none|not allowed|no photo/.test(value)) return "none";
  if (/window|before|after|only|from the back|no flash/.test(value)) return "window";
  if (/yes|allowed|fine|ok/.test(value)) return "allowed";
  return null;
}

/** What the crew should know about the Mass, in one line, or null. */
export function massRulesLine(answers: Record<string, unknown>): string | null {
  const rules = massRules(answers);
  if (rules === "none") return "Mass: no photography or video in the church.";
  if (rules === "window") return "Mass: photography only as the parish allows — before or after, or from the back with no flash.";
  return null;
}

export function planQuinceDay(input: {
  answers: Record<string, unknown>;
  /** Hours on the booking, in minutes, for where coverage ends when nobody said. */
  coverageMinutes?: number | null;
  /** The job's own venue, when the form names none. */
  venue?: string | null;
  /** A second photo/video team is booked: they take the getting ready and the cocktail hour. */
  secondTeam?: boolean;
  /** Only what the family gave (and their TBDs), no suggested lines. */
  answeredOnly?: boolean;
}): DayPlan {
  const answers = input.answers;
  const notes: string[] = [];
  const receptionPlace = answerFor(answers, PLACE_KEYS.reception) || input.venue || null;
  const massPlace = answerFor(answers, PLACE_KEYS.mass) || null;

  const start = clockAnswer(answerFor(answers, QUINCE_ANSWER_KEYS.cocktail));
  if (!start) {
    return {
      churchDay: false,
      firstLook: false,
      rows: [],
      coverageStart: null,
      coverageEnd: null,
      notes: ["There's no reception start time yet. The day is laid out from it once the family gives one."],
      withheld: 0,
    };
  }
  const R = clockMinutes(start);

  type Placed = { minutes: number; source: PlanSource; label: string; tbd: boolean };
  const placed = new Map<QuinceMilestone, Placed>();
  const fromForm = (key: QuinceMilestone): Placed | "tbd" | null => {
    const value = answerFor(answers, QUINCE_ANSWER_KEYS[key]);
    if (!value) return null;
    if (isTbd(value)) return "tbd";
    const clock = clockAnswer(value);
    return clock ? { minutes: clockMinutes(clock), source: "form", label: "From their form", tbd: false } : null;
  };
  for (const key of EVENING) {
    const answered = fromForm(key);
    if (answered && answered !== "tbd") {
      placed.set(key, answered);
      continue;
    }
    placed.set(key, {
      minutes: R + USUAL[key]!.at,
      source: "usual",
      label: answered === "tbd" ? "Their form: TBD" : "Suggested — check it",
      tbd: answered === "tbd",
    });
  }

  // The Mass only when they gave its time, and only before the reception.
  const mass = fromForm("mass");
  const rules = massRules(answers);
  if (mass && mass !== "tbd" && mass.minutes < R) placed.set("mass", mass);
  if (rules === "none") notes.push("The parish allows no photography or video during the Mass. It's on the crew sheet.");
  if (rules === "window") notes.push("The parish allows photos only before or after the Mass, or from the back. It's on the crew sheet.");

  // Coverage: their times, else the booking's hours from the first line, else six hours of reception.
  const earliest = Math.min(...[...placed.values()].map((at) => at.minutes));
  const arriveAnswer = fromForm("arrive");
  const arrive: Placed = arriveAnswer && arriveAnswer !== "tbd"
    ? arriveAnswer
    : { minutes: earliest, source: "coverage", label: "Starts with the first thing on the day", tbd: false };
  placed.set("arrive", arrive);
  const endAnswer = clockAnswer(answerFor(answers, COVERAGE_END_KEYS));
  const booked = input.coverageMinutes && input.coverageMinutes > 0 ? input.coverageMinutes : null;
  const end = endAnswer ? clockMinutes(endAnswer) : booked ? arrive.minutes + booked : R + 360;
  if (!endAnswer && !booked) notes.push("No coverage hours on the booking: the day ends six hours after the reception starts.");

  for (const [key, before] of [["cake", 45], ["last_dance", 15]] as const) {
    const answered = fromForm(key);
    placed.set(
      key,
      answered && answered !== "tbd"
        ? answered
        : { minutes: end - before, source: "usual", label: answered === "tbd" ? "Their form: TBD" : "Suggested — check it", tbd: answered === "tbd" },
    );
  }

  const whereFor = (key: QuinceMilestone): string | null => (key === "mass" ? massPlace : receptionPlace);
  const teamFor = (key: QuinceMilestone): Team => (input.secondTeam && key === "cocktail" ? "second" : "all");
  const titleFor = (key: QuinceMilestone) => (key === "mass" && rules === "none" ? "Mass (no photography)" : TITLES[key]);

  const order = Object.keys(TITLES) as QuinceMilestone[];
  let rows: PlanRow[] = [];
  for (const key of order) {
    const at = placed.get(key);
    const clock = at ? minutesClock(at.minutes) : null;
    if (!at || !clock) continue;
    rows.push({
      key: `quince:${key}`,
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
    const natural = key === "mass" ? 75 : (USUAL[key]?.length ?? 15);
    const next = rows.slice(index + 1).find((later) => sameTrack(row.team, later.team) && later.time > row.time);
    if (!next) return;
    const begin = clockMinutes(row.time);
    if (clockMinutes(next.time) - begin >= natural + 30) row.end = minutesClock(begin + natural);
  });
  const early = rows.filter((row) => keyOf(row) !== "arrive" && keyOf(row) !== "mass" && clockMinutes(row.time) < arrive.minutes);
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

/**
 * A DJ's quinceañera night: the reception in order, from the music planner's
 * reception start, every line laid out. No photo crew, no portraits, no Mass:
 * the DJ is at none of them.
 */
export function planQuinceNight(input: {
  answers: Record<string, unknown>;
  coverageMinutes?: number | null;
  venue?: string | null;
}): DayPlan {
  const plan = planQuinceDay({ ...input, secondTeam: false });
  const notForTheDj = new Set<QuinceMilestone>(["arrive", "family_portraits", "mass"]);
  return {
    ...plan,
    rows: plan.rows.filter((row) => !notForTheDj.has(keyOf(row))),
    notes: plan.notes.filter((note) => !/crew sheet|before coverage/.test(note)),
  };
}

function keyOf(row: PlanRow): QuinceMilestone {
  return String(row.key).replace(/^quince:/, "") as QuinceMilestone;
}
