/**
 * The published plan ladder.
 *
 * Solo was removed on 2026-08-25. A single-seat plan taxed the thing that
 * makes StudioCue worth having — bringing a second shooter or a coordinator
 * into the job — and the seat cap is a hard refusal, so the first studio to
 * grow hit a wall rather than a prompt. The entry plan now carries three
 * seats, which is a small studio rather than one person.
 *
 * Two plans, not three, because there are no customers yet and a ladder
 * nobody has climbed is a guess presented as a structure.
 */
export const planCards = [
  {
    key: "studio",
    name: "Studio",
    monthlyCents: 15_000,
    yearlyCents: 150_000,
    monthly: "$150",
    yearly: "$1,500",
    description: "Complete event operations for a photographer and their crew.",
    users: "3 internal users",
    ai: "2,500 AI actions",
    highlight: true,
    features: [
      "Unlimited clients and projects, up to 25 crew",
      "COI workflows and custom automations",
      "AI schedule generation and crew acknowledgment",
      "Advanced readiness reporting and priority support",
    ],
  },
  {
    key: "multi_brand",
    name: "Multi-Brand",
    monthlyCents: 29_900,
    yearlyCents: 299_000,
    monthly: "$299",
    yearly: "$2,990",
    description: "Standardized operations across larger teams and brands.",
    users: "15 internal users",
    ai: "7,500 AI actions",
    highlight: false,
    features: [
      "Everything in Studio, up to 100 crew",
      "3 separately branded businesses",
    ],
  },
] as const;

/**
 * The plan for the vendors who work alongside photographers: DJs, makeup
 * artists and hair stylists (features/trades/trades.ts). Conor, 2026-10-08:
 * $75 a month full price, because their journey has fewer steps and fewer
 * features than a photographer's. Conor, 2026-10-14: $100 a month, $1,000 a
 * year (two months free, like Studio); any code takes 50% off the first 12
 * months (features/subscriptions/referral-program.ts). Kept apart from
 * `planCards`, so the photographer plans' cards and the homepage's structured
 * data never include it; since the launch (2026-10-12) the website shows it in
 * its own section, on /pricing and on /dj, /makeup and /hair
 * (components/marketing/trade-landing.tsx). A studio sees only its trade's
 * plans (`plansForTrade`).
 */
export const vendorPlanCards = [
  {
    key: "vendor",
    name: "Pro",
    monthlyCents: 10_000,
    yearlyCents: 100_000,
    monthly: "$100",
    yearly: "$1,000",
    description: "Bookings, planning and payments for wedding and event vendors.",
    users: "2 internal users",
    ai: "1,000 AI actions",
    highlight: true,
    features: [
      "Unlimited clients and jobs, up to 10 crew",
      "Proposals, agreements and payments",
      "Planning forms and the plan for the day",
      "Cue drafts every next step for you to approve",
    ],
  },
] as const;

/** Every plan StudioCue sells, for the Console's revenue figures and plan lookups. */
export const allPlanCards = [...planCards, ...vendorPlanCards];

export type PlanCard = (typeof allPlanCards)[number];

/** The plans a studio of this trade can buy, by key (trades.ts `plans`). */
export function plansForTrade(planKeys: readonly string[]): PlanCard[] {
  return allPlanCards.filter((card) => planKeys.includes(card.key));
}
