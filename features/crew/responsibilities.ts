import { coverageRoleForLabel } from "@/features/crew/staffing-plan";

/**
 * What to suggest a crew member will be doing, before there is a run of show.
 *
 * Once the schedule exists the responsibilities come from it. Until then the
 * staffing form prefills a list, and that list was the constant
 * "Ceremony reactions / Cocktail-hour candids / Backup primary photographer" —
 * photography duties, sent with every offer whatever the role. Walked on
 * 2026-09-22: a videographer's offer told him his responsibilities included
 * being a backup primary photographer, at $950, on a real emailed offer.
 *
 * The suggestion follows the trade of the roles being filled. It is still only
 * a prefill — the studio types over it, and the field is theirs.
 */
const PHOTO = [
  "Ceremony reactions",
  "Cocktail-hour candids",
  "Backup primary photographer",
];

const VIDEO = [
  "Ceremony coverage",
  "Speeches and toasts",
  "Second-angle footage",
];

/**
 * Both trades on one job share one list, because the offer carries one list.
 * Naming both is better than naming the wrong one — and it is the case where
 * the studio most obviously needs to edit.
 */
const MIXED = ["Ceremony coverage", "Cocktail-hour candids", "Speeches and toasts"];

export function suggestedResponsibilities(
  roles: readonly string[],
): readonly string[] {
  const trades = new Set(roles.map((role) => coverageRoleForLabel(role)));
  if (!trades.size) return PHOTO;
  if (trades.size > 1) return MIXED;
  return trades.has("videographer") ? VIDEO : PHOTO;
}

export function suggestedResponsibilitiesText(roles: readonly string[]): string {
  return suggestedResponsibilities(roles).join("\n");
}
