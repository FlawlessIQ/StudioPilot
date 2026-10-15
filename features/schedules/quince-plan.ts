import type { DayPlan } from "./day-plan";
import { planPartyDay, planPartyNight, servicePhotoRules, type PartyInput, type PartySpec } from "./party-plan";

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

const MASS_RULES_KEYS = ["mass-photo-rules"];

/** A quinceañera, as the shared party engine reads it (party-plan.ts). */
export const QUINCE_SPEC: PartySpec<QuinceMilestone> = {
  prefix: "quince",
  titles: TITLES,
  answerKeys: QUINCE_ANSWER_KEYS,
  usual: USUAL,
  evening: EVENING,
  anchor: "cocktail",
  startName: "reception",
  placeKeys: ["reception-location", "party-location", "venue-address"],
  service: {
    key: "mass",
    placeKeys: ["church", "mass-location"],
    rulesKeys: MASS_RULES_KEYS,
    noneTitle: "Mass (no photography)",
    noneNote: "The parish allows no photography or video during the Mass. It's on the crew sheet.",
    windowNote: "The parish allows photos only before or after the Mass, or from the back. It's on the crew sheet.",
    length: 75,
  },
  coverageEndKeys: ["coverageEndTime", "coverage-end-time", "reception-end-time", "party-end-time", "end-time"],
  defaultHours: 6,
  secondTeamLine: "cocktail",
  notForTheDj: ["arrive", "family_portraits", "mass"],
};

/**
 * Whether the parish lets cameras into the Mass: "none" keeps them out,
 * "window" allows photos only before or after, "allowed" covers it. Null
 * when the family hasn't said.
 */
export function massRules(answers: Record<string, unknown>): "none" | "window" | "allowed" | null {
  return servicePhotoRules(answers, MASS_RULES_KEYS);
}

/** What the crew should know about the Mass, in one line, or null. */
export function massRulesLine(answers: Record<string, unknown>): string | null {
  const rules = massRules(answers);
  if (rules === "none") return "Mass: no photography or video in the church.";
  if (rules === "window") return "Mass: photography only as the parish allows — before or after, or from the back with no flash.";
  return null;
}

export function planQuinceDay(input: PartyInput): DayPlan {
  return planPartyDay(QUINCE_SPEC, input);
}

/**
 * A DJ's quinceañera night: the reception in order, from the music planner's
 * reception start, every line laid out. No photo crew, no portraits, no Mass:
 * the DJ is at none of them.
 */
export function planQuinceNight(input: { answers: Record<string, unknown>; coverageMinutes?: number | null; venue?: string | null }): DayPlan {
  return planPartyNight(QUINCE_SPEC, input);
}
