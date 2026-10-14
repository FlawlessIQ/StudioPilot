import { planDay, type DayPlan } from "./day-plan";
import { planMitzvahDay } from "./mitzvah-plan";
import type { JourneyProfile } from "@/features/job-kinds/job-kinds";

/**
 * The day a kind lays out from its form alone (job-kinds.ts `dayPlan`): a
 * wedding's from the ceremony (day-plan.ts), a mitzvah's from the party
 * (mitzvah-plan.ts). The same input and the same plan either way, so the
 * schedule editor needn't know which.
 */
export function planBuiltDay(
  plan: JourneyProfile["dayPlan"],
  input: Parameters<typeof planDay>[0],
): DayPlan {
  if (plan === "mitzvah") {
    const { answers, coverageMinutes, venue, secondTeam, answeredOnly } = input;
    return planMitzvahDay({ answers, coverageMinutes, venue, secondTeam, answeredOnly });
  }
  return planDay(input);
}
