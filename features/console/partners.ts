/**
 * The partner program's money, for Console → Partners.
 *
 * Conor and GR Productions, 2026-10-07: $100 for each studio a partner brings
 * in, counted when that studio's first annual payment clears; at ten paid
 * studios every one of them is worth $200, the first ten included — $2,000 —
 * and each after that $200. Pure; functions/src/console/handlers/partners.ts
 * holds the codes and payouts.
 */

export const PARTNER_BASE_CENTS = 10_000;
export const PARTNER_BOOSTED_CENTS = 20_000;
export const PARTNER_BOOST_AT = 10;

/** Earned for this many paid studios. */
export function partnerEarnedCents(paidStudios: number): number {
  const count = Math.max(0, Math.floor(paidStudios));
  return count * (count >= PARTNER_BOOST_AT ? PARTNER_BOOSTED_CENTS : PARTNER_BASE_CENTS);
}

/** How many more paid studios until every one is worth $200; 0 once there. */
export function untilBoost(paidStudios: number): number {
  return Math.max(0, PARTNER_BOOST_AT - Math.max(0, Math.floor(paidStudios)));
}

export const PARTNER_KIND_LABELS: Record<string, string> = {
  dj: "DJ",
  hair: "Hair",
  makeup: "Makeup",
  hair_makeup: "Hair & makeup",
  planner: "Planner",
  venue: "Venue",
  florist: "Florist",
  photographer: "Photographer",
  videographer: "Videographer",
  other: "Other",
};

/** A code suggested from a name: "Albert Gershengoren" → "GERSH40". */
export function suggestPartnerCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = (words[words.length - 1] ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const stem = last.slice(0, 6) || "PARTNER";
  return `${stem}40`;
}
