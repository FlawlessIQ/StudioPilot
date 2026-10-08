import { coverageCount, type CoverageItem, type CoverageRole } from "./coverage";

/**
 * A "per crew member" retainer that counts nobody on its own package.
 *
 * GR Productions (2026-10-06): "Retainer should be $4000 for this. I have
 * setup for $1000 per crew member." The proposal said $1,000. Their Gold
 * Cinematic Package — two videographers — charged "$1,000 per photographer",
 * because switching a package to per-crew in the editor ticked photographers
 * and nothing else. Nobody on it was a photographer, so the rule counted no
 * one, and billedCrewCount's floor of one charged for a single person.
 *
 * The floor stays (create-snapshot.ts): changing it would reprice live
 * packages. Instead this is refused where a rule is written — the editor and
 * the server — and flagged on any package that already has it.
 */

const ROLE_WORDS: Record<CoverageRole, string> = { photographer: "photographers", videographer: "videographers", dj: "DJs" };

/** How many of the package's own crew the rule's roles cover (no floor). */
export function crewTheRuleCounts(coverage: readonly CoverageItem[], billedRoles: readonly CoverageRole[] | undefined): number {
  const roles = billedRoles?.length ? billedRoles : (["photographer"] as const);
  return roles.reduce((sum, role) => sum + coverageCount(coverage, role), 0);
}

/**
 * What is wrong, in the studio's words, or null. Only for a per-crew rule on
 * a package with crew: a fixed or percentage retainer counts no one.
 */
export function perCrewRetainerProblem(input: {
  coverage: readonly CoverageItem[];
  billedRoles: readonly CoverageRole[] | undefined;
}): string | null {
  const crew = input.coverage.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  if (!crew || crewTheRuleCounts(input.coverage, input.billedRoles) > 0) return null;
  const charged = (input.billedRoles?.length ? input.billedRoles : (["photographer"] as const)).map((role) => ROLE_WORDS[role]).join(" and ");
  const has = input.coverage.filter((item) => item.count > 0).map((item) => ROLE_WORDS[item.role]).join(" and ");
  return `This retainer is charged per ${charged.replace(/s(?= and|$)/g, "")}, but this package has no ${charged} — only ${has}. It would charge for one person. Check the ${has} it includes.`;
}

/** The roles a new per-crew rule should charge for: everyone the package sends. */
export function rolesThePackageSends(coverage: readonly CoverageItem[]): CoverageRole[] {
  return coverage.filter((item) => item.count > 0).map((item) => item.role);
}
