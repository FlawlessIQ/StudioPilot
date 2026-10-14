import { clockMinutes, clockOf, minutesClock } from "./day-clock";
import type { DayPlan, PlanRow, PlanSource, Team } from "./day-plan";

/**
 * A bar or bat mitzvah's day, laid out from what the family told the studio
 * (docs/mitzvah-journey-plan-2026-10-14.md, Phase 3).
 *
 * The party is the anchor, as the ceremony is a wedding's: its start is when
 * the cocktail hour (and the kids' room) opens, and the evening runs in the
 * usual order from there — grand entrance, hora, the blessings over the
 * challah and wine, the parents' speech, dinner, the candle lighting, the
 * montage, dancing and games, cake, the last dance. Before it, the family's
 * portraits at the venue. Each line comes from, in order:
 *   1. the family's own time for it on the Final schedule form;
 *   2. its usual place in the evening, counted from the party's start.
 *
 * The service is the synagogue's, often on Shabbat with no photography: it is
 * on the plan only when the family gave its time, and says when the
 * congregation's rules keep the cameras out. The portrait session at the
 * synagogue is usually a different day; the plan says so rather than placing
 * it.
 *
 * No timing rules: like a wedding's day plan, this is built from the form
 * alone. Pure: no I/O, no clock.
 */

export type MitzvahMilestone =
  | "arrive"
  | "service"
  | "family_portraits"
  | "cocktail"
  | "kids_room"
  | "entrance"
  | "hora"
  | "blessings"
  | "speeches"
  | "dinner"
  | "candles"
  | "montage"
  | "dancing"
  | "cake"
  | "last_dance";

const TITLES: Record<MitzvahMilestone, string> = {
  arrive: "Photo and video arrive",
  service: "Service",
  family_portraits: "Family portraits",
  cocktail: "Cocktail hour",
  kids_room: "Kids' room",
  entrance: "Grand entrance",
  hora: "Hora",
  blessings: "Blessings over the challah and wine",
  speeches: "Parents' speech and toast",
  dinner: "Dinner",
  candles: "Candle lighting",
  montage: "Montage",
  dancing: "Dancing and games",
  cake: "Cake",
  last_dance: "Last dance",
};

/** The family's own time for a line, by the Final schedule form's question ids. */
export const MITZVAH_ANSWER_KEYS: Record<Exclude<MitzvahMilestone, "kids_room">, readonly string[]> = {
  arrive: ["coverageStartTime", "coverage-start-time", "photographyStartTime"],
  service: ["service-time"],
  family_portraits: ["family-portraits-time"],
  cocktail: ["party-start-time", "cocktail-hour-time"],
  entrance: ["grand-entrance-time"],
  hora: ["hora-time"],
  blessings: ["blessings-time"],
  speeches: ["speeches-time"],
  dinner: ["dinner-time"],
  candles: ["candle-lighting-time"],
  montage: ["montage-time"],
  dancing: ["dancing-time"],
  cake: ["cake-time", "cake-cutting-time"],
  last_dance: ["last-dance-time"],
};

/** When each line usually starts, in minutes from the party's start, and how long it runs. */
const USUAL: Partial<Record<MitzvahMilestone, { at: number; length: number }>> = {
  family_portraits: { at: -75, length: 45 },
  cocktail: { at: 0, length: 60 },
  entrance: { at: 60, length: 5 },
  hora: { at: 65, length: 15 },
  blessings: { at: 80, length: 10 },
  speeches: { at: 90, length: 15 },
  dinner: { at: 105, length: 60 },
  candles: { at: 165, length: 30 },
  montage: { at: 195, length: 10 },
  dancing: { at: 205, length: 60 },
};

const COVERAGE_END_KEYS = ["coverageEndTime", "coverage-end-time", "party-end-time", "end-time"];
const SERVICE_RULES_KEYS = ["service-photo-rules"];
const PLACE_KEYS = {
  service: ["synagogue", "synagogue-name", "service-location"],
  party: ["party-location", "party-venue", "venue-address", "reception-location"],
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
 * Whether the congregation lets cameras into the service, from the form's
 * answer: "none" keeps them out entirely, "window" allows a portrait window
 * only, "allowed" covers it. Null when the family hasn't said.
 */
export function serviceRules(answers: Record<string, unknown>): "none" | "window" | "allowed" | null {
  const value = answerFor(answers, SERVICE_RULES_KEYS).toLowerCase();
  if (!value || isTbd(value)) return null;
  if (/^no\b|none|not allowed|no photo/.test(value)) return "none";
  if (/window|before|after|only/.test(value)) return "window";
  if (/yes|allowed|fine|ok/.test(value)) return "allowed";
  return null;
}

/** What the crew should know about the service, in one line, or null. */
export function serviceRulesLine(answers: Record<string, unknown>): string | null {
  const rules = serviceRules(answers);
  if (rules === "none") return "Service: no photography or video in the sanctuary.";
  if (rules === "window") return "Service: photography only in the congregation's portrait window — none during the service.";
  return null;
}

export function planMitzvahDay(input: {
  answers: Record<string, unknown>;
  /** Hours on the booking, in minutes, for where coverage ends when nobody said. */
  coverageMinutes?: number | null;
  /** The job's own venue, when the form names none. */
  venue?: string | null;
  /** A second photo/video team is booked: they take the kids' room. */
  secondTeam?: boolean;
  /** Only what the family gave (and their TBDs), no suggested lines. */
  answeredOnly?: boolean;
}): DayPlan {
  const answers = input.answers;
  const notes: string[] = [];
  const partyPlace = answerFor(answers, PLACE_KEYS.party) || input.venue || null;
  const servicePlace = answerFor(answers, PLACE_KEYS.service) || null;

  const partyStart = clockAnswer(answerFor(answers, MITZVAH_ANSWER_KEYS.cocktail));
  if (!partyStart) {
    return {
      churchDay: false,
      firstLook: false,
      rows: [],
      coverageStart: null,
      coverageEnd: null,
      notes: ["There's no party start time yet. The day is laid out from it once the family gives one."],
      withheld: 0,
    };
  }
  const P = clockMinutes(partyStart);

  type Placed = { minutes: number; source: PlanSource; label: string; tbd: boolean };
  const placed = new Map<MitzvahMilestone, Placed>();
  const fromForm = (key: Exclude<MitzvahMilestone, "kids_room">): Placed | "tbd" | null => {
    const value = answerFor(answers, MITZVAH_ANSWER_KEYS[key]);
    if (!value) return null;
    if (isTbd(value)) return "tbd";
    const clock = clockAnswer(value);
    return clock ? { minutes: clockMinutes(clock), source: "form", label: "From their form", tbd: false } : null;
  };
  const place = (key: Exclude<MitzvahMilestone, "kids_room" | "arrive" | "service" | "cake" | "last_dance">) => {
    const answered = fromForm(key);
    if (answered && answered !== "tbd") return placed.set(key, answered);
    const usual = USUAL[key]!;
    placed.set(key, {
      minutes: P + usual.at,
      source: "usual",
      label: answered === "tbd" ? "Their form: TBD" : "Suggested — check it",
      tbd: answered === "tbd",
    });
  };
  for (const key of ["family_portraits", "cocktail", "entrance", "hora", "blessings", "speeches", "dinner", "candles", "montage", "dancing"] as const) {
    place(key);
  }

  // The service only when they gave its time: often another day, and often closed to cameras.
  const service = fromForm("service");
  const rules = serviceRules(answers);
  if (service && service !== "tbd" && service.minutes < P) placed.set("service", service);
  if (rules === "none") notes.push("The congregation allows no photography or video during the service. It's on the crew sheet.");
  if (rules === "window") notes.push("The congregation allows photos only in its portrait window. It's on the crew sheet.");
  if (answerFor(answers, ["portrait-session-date"])) {
    notes.push("The portrait session at the synagogue is on its own date. Add it to the calendar; it isn't on this day's plan.");
  }

  // Coverage: their times, else the booking's hours from the first line, else five hours of party.
  // Not from the service: a Saturday-morning service isn't the evening's coverage.
  const earliest = Math.min(...[...placed.entries()].filter(([key]) => key !== "service").map(([, at]) => at.minutes));
  const arriveAnswer = fromForm("arrive");
  const arrive: Placed = arriveAnswer && arriveAnswer !== "tbd"
    ? arriveAnswer
    : { minutes: earliest, source: "coverage", label: "Starts with the first thing on the day", tbd: false };
  placed.set("arrive", arrive);
  const endAnswer = clockAnswer(answerFor(answers, COVERAGE_END_KEYS));
  const booked = input.coverageMinutes && input.coverageMinutes > 0 ? input.coverageMinutes : null;
  const end = endAnswer ? clockMinutes(endAnswer) : booked ? arrive.minutes + booked : P + 300;
  if (!endAnswer && !booked) notes.push("No coverage hours on the booking: the day ends five hours after the party starts.");

  // The end of the night, from the end of coverage.
  for (const [key, before] of [["cake", 45], ["last_dance", 15]] as const) {
    const answered = fromForm(key);
    placed.set(
      key,
      answered && answered !== "tbd"
        ? answered
        : { minutes: end - before, source: "usual", label: answered === "tbd" ? "Their form: TBD" : "Suggested — check it", tbd: answered === "tbd" },
    );
  }
  // A second team takes the kids' room through the cocktail hour.
  const cocktail = placed.get("cocktail")!;
  if (input.secondTeam) placed.set("kids_room", { ...cocktail, label: cocktail.label });

  const whereFor = (key: MitzvahMilestone): string | null => (key === "service" ? servicePlace : partyPlace);
  const teamFor = (key: MitzvahMilestone): Team => {
    if (!input.secondTeam) return "all";
    if (key === "kids_room") return "second";
    if (key === "cocktail" || key === "family_portraits") return "first";
    return "all";
  };
  const titleFor = (key: MitzvahMilestone) =>
    key === "service" && rules === "none" ? "Service (no photography)" : TITLES[key];

  const order = Object.keys(TITLES) as MitzvahMilestone[];
  let rows: PlanRow[] = [];
  for (const key of order) {
    const at = placed.get(key);
    const clock = at ? minutesClock(at.minutes) : null;
    if (!at || !clock) continue;
    rows.push({
      key: `mitzvah:${key}`,
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
    const natural = key === "service" ? 120 : (USUAL[key]?.length ?? 15);
    const next = rows.slice(index + 1).find((later) => sameTrack(row.team, later.team) && later.time > row.time);
    if (!next) return;
    const start = clockMinutes(row.time);
    if (clockMinutes(next.time) - start >= natural + 30) row.end = minutesClock(start + natural);
  });
  const early = rows.filter((row) => keyOf(row) !== "arrive" && keyOf(row) !== "service" && clockMinutes(row.time) < arrive.minutes);
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

function keyOf(row: PlanRow): MitzvahMilestone {
  return String(row.key).replace(/^mitzvah:/, "") as MitzvahMilestone;
}
