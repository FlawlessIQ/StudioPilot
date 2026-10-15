import type { DayPlan } from "./day-plan";
import { planPartyDay, planPartyNight, type PartyInput, type PartySpec } from "./party-plan";

/**
 * A Sweet 16's day, laid out from what the family told the studio
 * (docs/new-job-kinds-execution-plan-2026-10-15.md, Phase 2), on the shared
 * party engine (party-plan.ts). The party is the day: guests arrive, the
 * grand entrance, the candle lighting (sixteen candles, a song each), a
 * special dance with a parent, the toast, dinner, dancing and games, cake,
 * the last dance. Before it, portraits with family and friends. No service.
 */

export type Sweet16Milestone =
  | "arrive"
  | "family_portraits"
  | "guests_arrive"
  | "entrance"
  | "candles"
  | "special_dance"
  | "toast"
  | "dinner"
  | "dancing"
  | "cake"
  | "last_dance";

const TITLES: Record<Sweet16Milestone, string> = {
  arrive: "Photo and video arrive",
  family_portraits: "Portraits with family and friends",
  guests_arrive: "Guests arrive",
  entrance: "Grand entrance",
  candles: "Candle lighting",
  // "Parent" so the MC script finds the parent-dance song (mc-script.ts).
  special_dance: "Parent dance",
  toast: "The toast",
  dinner: "Dinner",
  // "games" so the MC script finds the games (mc-script.ts).
  dancing: "Dancing and games",
  cake: "Cake",
  last_dance: "Last dance",
};

/** The family's own time for a line, by the Final schedule form's question ids. */
export const SWEET16_ANSWER_KEYS: Record<Sweet16Milestone, readonly string[]> = {
  arrive: ["coverageStartTime", "coverage-start-time", "photographyStartTime"],
  family_portraits: ["family-portraits-time"],
  guests_arrive: ["party-start-time"],
  entrance: ["grand-entrance-time"],
  candles: ["candle-lighting-time"],
  special_dance: ["special-dance-time"],
  toast: ["toast-time"],
  dinner: ["dinner-time"],
  dancing: ["dancing-time"],
  cake: ["cake-time", "cake-cutting-time"],
  last_dance: ["last-dance-time"],
};

/** When each line usually starts, in minutes from the party's start, and how long it runs. */
const USUAL: Partial<Record<Sweet16Milestone, { at: number; length: number }>> = {
  family_portraits: { at: -45, length: 30 },
  guests_arrive: { at: 0, length: 45 },
  entrance: { at: 45, length: 5 },
  candles: { at: 50, length: 30 },
  special_dance: { at: 80, length: 5 },
  toast: { at: 85, length: 10 },
  dinner: { at: 95, length: 60 },
  dancing: { at: 155, length: 60 },
};

/** A Sweet 16, as the shared party engine reads it. */
export const SWEET16_SPEC: PartySpec<Sweet16Milestone> = {
  prefix: "sweet16",
  titles: TITLES,
  answerKeys: SWEET16_ANSWER_KEYS,
  usual: USUAL,
  evening: ["family_portraits", "guests_arrive", "entrance", "candles", "special_dance", "toast", "dinner", "dancing"],
  anchor: "guests_arrive",
  startName: "party",
  placeKeys: ["party-location", "party-venue", "venue-address"],
  coverageEndKeys: ["coverageEndTime", "coverage-end-time", "party-end-time", "end-time"],
  defaultHours: 5,
  notForTheDj: ["arrive", "family_portraits"],
};

export function planSweet16Day(input: PartyInput): DayPlan {
  return planPartyDay(SWEET16_SPEC, input);
}

/** A DJ's Sweet 16 night: the party in order, with no photo crew and no portraits. */
export function planSweet16Night(input: { answers: Record<string, unknown>; coverageMinutes?: number | null; venue?: string | null }): DayPlan {
  return planPartyNight(SWEET16_SPEC, input);
}
