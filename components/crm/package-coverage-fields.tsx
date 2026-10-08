"use client";

import type { CoverageRole } from "@/features/packages/coverage";

/**
 * The form's two counts, as coverage.
 *
 * Shared by the create and edit forms so a package saved either way has the
 * same shape. A role with a count of zero is simply absent — never an entry
 * saying the studio sends no videographer. The two counts are the studio's
 * own roles (trades.ts `coverageRoles`): a photographer's photographers and
 * videographers, a DJ's DJs (one count, the second unused).
 */
export function coverageFrom(
  values: {
    photographers: number;
    videographers: number;
  },
  roles: readonly CoverageRole[] = ["photographer", "videographer"],
): { role: CoverageRole; count: number }[] {
  const coverage: { role: CoverageRole; count: number }[] = [];
  const [first, second] = roles;
  if (first && values.photographers > 0)
    coverage.push({ role: first, count: values.photographers });
  if (second && values.videographers > 0)
    coverage.push({ role: second, count: values.videographers });
  return coverage;
}

/**
 * Which roles a per-crew-member retainer charges for.
 *
 * Only ever sent with that retainer type. A package written before roles
 * existed sends nothing here and keeps billing photographers only, which is
 * what it has always meant — so no package changes price by this release.
 */
export function billedRolesFrom(
  values: {
    billPhotographers: boolean;
    billVideographers: boolean;
  },
  roles: readonly CoverageRole[] = ["photographer", "videographer"],
): CoverageRole[] {
  const billed: CoverageRole[] = [];
  const [first, second] = roles;
  if (first && values.billPhotographers) billed.push(first);
  if (second && values.billVideographers) billed.push(second);
  return billed;
}
