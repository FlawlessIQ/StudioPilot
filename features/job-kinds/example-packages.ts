import type { JobKind } from "@/features/job-kinds/job-kinds";

/**
 * Example packages per kind of work — a starting shape, never a price
 * (docs/job-types-plan-2026-10-02.md, starter kits).
 *
 * "Start from an example" on the new-package form fills the name, coverage,
 * crew and deliverables. The price stays empty: what a studio charges is the
 * studio's, and setup promises nothing is invented. Payment follows the kind
 * (journeyProfile), so a family session starts "paid in full".
 */
export type ExamplePackage = {
  name: string;
  description: string;
  coverageHours: number;
  photographers: number;
  videographers: number;
  deliverables: string;
};

export const EXAMPLE_PACKAGES: Record<JobKind, readonly ExamplePackage[]> = {
  wedding: [
    {
      name: "Full-day wedding",
      description: "Getting ready through the first dances, with a second photographer.",
      coverageHours: 8,
      photographers: 2,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads",
    },
    {
      name: "Elopement",
      description: "The ceremony and portraits, for a small wedding.",
      coverageHours: 2,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads",
    },
  ],
  portraits: [
    {
      name: "Mini session",
      description: "A short session at one location, for a quick update or a holiday card.",
      coverageHours: 0.5,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, 10 edited images",
    },
    {
      name: "Family session",
      description: "An unhurried session with time for everyone, and the little ones.",
      coverageHours: 1.5,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads",
    },
    {
      name: "Newborn session",
      description: "A gentle session at home in the baby's first weeks.",
      coverageHours: 2,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads",
    },
  ],
  corporate: [
    {
      name: "Half-day event",
      description: "Arrivals, the main sessions and the people who matter.",
      coverageHours: 4,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads, Same-week delivery",
    },
    {
      name: "Full-day event",
      description: "The whole day, from registration to the reception.",
      coverageHours: 8,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads, Same-week delivery",
    },
    {
      name: "Team headshots",
      description: "A headshot station on site, one edited headshot per person.",
      coverageHours: 2,
      photographers: 1,
      videographers: 0,
      deliverables: "One edited headshot per person, Online gallery",
    },
  ],
  sports: [
    {
      name: "Game day",
      description: "Action through the game, and the moments after.",
      coverageHours: 3,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads",
    },
    {
      name: "Team and individual photos",
      description: "The team photo and a portrait of every player.",
      coverageHours: 3,
      photographers: 2,
      videographers: 0,
      deliverables: "Team photo, Individual portraits, Online gallery",
    },
  ],
  other: [
    {
      name: "Event coverage",
      description: "Coverage of your event, start to finish.",
      coverageHours: 3,
      photographers: 1,
      videographers: 0,
      deliverables: "Online gallery, High-resolution downloads",
    },
  ],
};

/**
 * A DJ's examples (docs/vendor-journeys.md: a reception package of 4–6
 * hours, ceremony and cocktail hour as add-ons or a fuller package). The
 * counts are the studio's own first role (trades.ts `coverageRoles`), so
 * `photographers` here is DJs; "deliverables" reads as what's included.
 */
const DJ_EXAMPLES: Partial<Record<JobKind, readonly ExamplePackage[]>> = {
  wedding: [
    {
      name: "Reception",
      description: "Your reception, from the grand entrance to the last dance, with your DJ as MC.",
      coverageHours: 5,
      photographers: 1,
      videographers: 0,
      deliverables: "Reception sound, Dance floor lighting, MC, Online music planner",
    },
    {
      name: "Ceremony and reception",
      description: "Ceremony sound with wireless microphones, cocktail hour music, and the reception.",
      coverageHours: 6,
      photographers: 1,
      videographers: 0,
      deliverables: "Ceremony sound and microphones, Cocktail hour music, Reception sound, MC, Online music planner",
    },
  ],
  corporate: [
    {
      name: "Corporate event",
      description: "Background music, announcements and the dance floor for your event.",
      coverageHours: 4,
      photographers: 1,
      videographers: 0,
      deliverables: "Sound system, Wireless microphone, MC announcements",
    },
  ],
  other: [
    {
      name: "Party",
      description: "Music and MC for your party, start to finish.",
      coverageHours: 4,
      photographers: 1,
      videographers: 0,
      deliverables: "Sound system, Dance floor lighting, MC",
    },
  ],
};

/**
 * A makeup artist's examples (docs/vendor-journeys.md): the bride's makeup is
 * the package, and everyone else is priced per person as an extra
 * (extra-ideas.ts), so the quote reads "4 people × $120". `photographers` is
 * artists; "deliverables" is what's included.
 */
const MAKEUP_EXAMPLES: Partial<Record<JobKind, readonly ExamplePackage[]>> = {
  wedding: [
    {
      name: "Bridal makeup",
      description: "Your makeup on the morning, with lashes, and a touch-up kit to take with you.",
      coverageHours: 1.5,
      photographers: 1,
      videographers: 0,
      deliverables: "Bridal makeup, Lashes, Touch-up kit",
    },
    {
      name: "Bridal makeup with trial",
      description: "A trial a few months before to settle your look, then your makeup on the morning.",
      coverageHours: 3,
      photographers: 1,
      videographers: 0,
      deliverables: "Makeup trial, Bridal makeup, Lashes, Touch-up kit",
    },
  ],
  other: [
    {
      name: "Event makeup",
      description: "Makeup for your event, at your place or ours.",
      coverageHours: 1,
      photographers: 1,
      videographers: 0,
      deliverables: "Full makeup, Lashes",
    },
  ],
};

/** A hair stylist's examples: the bride's hair is the package, the party per person. */
const HAIR_EXAMPLES: Partial<Record<JobKind, readonly ExamplePackage[]>> = {
  wedding: [
    {
      name: "Bridal hair",
      description: "Your hair on the morning, with your veil and accessories placed.",
      coverageHours: 1.5,
      photographers: 1,
      videographers: 0,
      deliverables: "Bridal hair, Veil placement",
    },
    {
      name: "Bridal hair with trial",
      description: "A trial once your veil is chosen, then your hair on the morning.",
      coverageHours: 3,
      photographers: 1,
      videographers: 0,
      deliverables: "Hair trial, Bridal hair, Veil placement",
    },
  ],
  other: [
    {
      name: "Event hair",
      description: "Hair styling for your event, at your place or ours.",
      coverageHours: 1,
      photographers: 1,
      videographers: 0,
      deliverables: "Styling",
    },
  ],
};

/** The examples for a studio of this trade and a job of this kind. */
export function examplePackagesFor(trade: string, kind: JobKind): readonly ExamplePackage[] {
  if (trade === "dj") return DJ_EXAMPLES[kind] ?? DJ_EXAMPLES.other ?? [];
  if (trade === "makeup") return MAKEUP_EXAMPLES[kind] ?? MAKEUP_EXAMPLES.other ?? [];
  if (trade === "hair") return HAIR_EXAMPLES[kind] ?? HAIR_EXAMPLES.other ?? [];
  return EXAMPLE_PACKAGES[kind];
}
