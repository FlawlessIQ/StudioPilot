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
