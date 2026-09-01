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
    monthlyCents: 25_000,
    yearlyCents: 250_000,
    monthly: "$250",
    yearly: "$2,500",
    description: "Complete event operations for a photographer and their crew.",
    users: "3 internal users",
    ai: "2,500 AI actions",
    highlight: true,
    features: [
      "Unlimited clients and projects, up to 25 crew",
      "COI workflows and custom automations",
      "AI schedule generation and crew acknowledgement",
      "Advanced readiness reporting and priority support",
    ],
  },
  {
    key: "multi_brand",
    name: "Multi-Brand",
    monthlyCents: 39_900,
    yearlyCents: 399_000,
    monthly: "$399",
    yearly: "$3,990",
    description: "Standardized operations across larger teams and brands.",
    users: "15 internal users",
    ai: "7,500 AI actions",
    highlight: false,
    features: [
      "Everything in Studio, up to 100 crew",
      "3 separately branded businesses",
      "Advanced permissions and portfolio reporting",
      "API access and priority onboarding",
    ],
  },
] as const;
