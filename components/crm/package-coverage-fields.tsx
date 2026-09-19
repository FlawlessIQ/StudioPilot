"use client";

/**
 * The form's two counts, as coverage.
 *
 * Shared by the create and edit forms so a package saved either way has the
 * same shape. A role with a count of zero is simply absent — never an entry
 * saying the studio sends no videographer.
 */
export function coverageFrom(values: {
  photographers: number;
  videographers: number;
}): { role: "photographer" | "videographer"; count: number }[] {
  const coverage: { role: "photographer" | "videographer"; count: number }[] = [];
  if (values.photographers > 0)
    coverage.push({ role: "photographer", count: values.photographers });
  if (values.videographers > 0)
    coverage.push({ role: "videographer", count: values.videographers });
  return coverage;
}

/**
 * Which roles a per-crew-member retainer charges for.
 *
 * Only ever sent with that retainer type. A package written before roles
 * existed sends nothing here and keeps billing photographers only, which is
 * what it has always meant — so no package changes price by this release.
 */
export function billedRolesFrom(values: {
  billPhotographers: boolean;
  billVideographers: boolean;
}): ("photographer" | "videographer")[] {
  const roles: ("photographer" | "videographer")[] = [];
  if (values.billPhotographers) roles.push("photographer");
  if (values.billVideographers) roles.push("videographer");
  return roles;
}
