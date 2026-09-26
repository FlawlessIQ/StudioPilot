import { planCards } from "@/config/saas-plans";

/**
 * The plan a studio picked on the website, carried to the plan picker.
 *
 * "Start with Multi-Brand" went to /auth/register?plan=multi_brand, and the
 * `plan` was read by nothing: after verifying and naming the studio, the owner
 * chose again from four buttons, with "Current" on Studio whichever they had
 * picked (docs/onboarding-assessment-2026-09-26.md). Browser storage is
 * enough: it's a preference for one screen, not a record.
 */
const KEY = "studiocue.chosenPlan";

export function rememberChosenPlan(plan: string | null | undefined): void {
  if (!plan || !planCards.some((card) => card.key === plan)) return;
  try {
    window.localStorage.setItem(KEY, plan);
  } catch {
    // Private mode or blocked storage: the picker just shows no preference.
  }
}

export function chosenPlan(): string | null {
  try {
    const plan = window.localStorage.getItem(KEY);
    return plan && planCards.some((card) => card.key === plan) ? plan : null;
  } catch {
    return null;
  }
}
