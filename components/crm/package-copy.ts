import { tradeProfile, tradeVocab } from "@/features/trades/trades";

/**
 * The words around a studio's packages, in its trade's terms (trades.ts).
 *
 * A photographer's packages are coverage and deliverables. A DJ, a makeup
 * artist or a hair stylist sells a service and lists what's included, so a
 * hair studio opening Packages read "pricing, coverage, deliverables" about a
 * bridal hair booking (walked 2026-10-09). A photographer's reads exactly as
 * it always did.
 *
 * Pure, and kept apart from the client components that show it, so the pages
 * and the tests read the same sentences.
 */

/** The Packages page, under its title. */
export function packagesPageDescription(trade: unknown): string {
  return tradeProfile(trade).family === "photo"
    ? "Build reusable offers with pricing, coverage, deliverables, and add-ons. Existing project prices never change."
    : `Build reusable offers with pricing, ${tradeVocab(trade).includedLabel.toLowerCase()}, and add-ons. Existing project prices never change.`;
}

/** "Create a package", under its title. */
export function newPackageIntro(trade: unknown): string {
  return tradeProfile(trade).family === "photo"
    ? "Define the price, coverage, retainer, and deliverables clients can choose."
    : `Define the price, hours, ${tradeVocab(trade).deposit}, and ${tradeVocab(trade).includedLabel.toLowerCase()} for each package clients can choose.`;
}

/** The Library's Packages shelf. */
export function packagesShelfDescription(trade: unknown): string {
  return tradeProfile(trade).family === "photo"
    ? "Build reusable offers, pricing, coverage, and add-ons."
    : `Build reusable offers, pricing, ${tradeVocab(trade).includedLabel.toLowerCase()}, and add-ons.`;
}
