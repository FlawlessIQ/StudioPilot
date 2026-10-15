import { planDay, type DayPlan } from "./day-plan";
import { planMitzvahDay, planMitzvahNight } from "./mitzvah-plan";
import { planNight } from "./night-plan";
import type { JourneyProfile } from "@/features/job-kinds/job-kinds";

type DayInput = Parameters<typeof planDay>[0];
type NightInput = Parameters<typeof planNight>[0];

/**
 * The day and the DJ's night a kind lays out from its form alone (job-kinds.ts
 * `dayPlan`): a wedding's from the ceremony (day-plan.ts, night-plan.ts), a
 * mitzvah's from the party (mitzvah-plan.ts). The same input and the same
 * plan either way, so the schedule editor needn't know which. A kind with a
 * day of its own is a row here (docs/adding-a-job-kind-playbook.md).
 */
const BUILT_DAYS: Record<string, { day: (input: DayInput) => DayPlan; night: (input: NightInput) => DayPlan }> = {
  wedding: { day: planDay, night: planNight },
  mitzvah: {
    day: ({ answers, coverageMinutes, venue, secondTeam, answeredOnly }) =>
      planMitzvahDay({ answers, coverageMinutes, venue, secondTeam, answeredOnly }),
    night: planMitzvahNight,
  },
};

export function planBuiltDay(plan: JourneyProfile["dayPlan"], input: DayInput): DayPlan {
  return (BUILT_DAYS[plan ?? "wedding"] ?? BUILT_DAYS.wedding).day(input);
}

/** A DJ's night for the kind's day plan: a wedding's, or the kind's own. */
export function planBuiltNight(plan: JourneyProfile["dayPlan"], input: NightInput): DayPlan {
  return (BUILT_DAYS[plan ?? "wedding"] ?? BUILT_DAYS.wedding).night(input);
}
