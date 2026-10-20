/**
 * Mirror of features/console/test-studios.ts — functions/ is a separate
 * package with no "@/features" path. Compared below the header by
 * tests/console-test-studios.test.ts. The daily metrics leave these out.
 */

export const TEST_TAG = "test";
export const REAL_TAG = "real";
export const TEAM_EMAIL_DOMAINS = ["flawlessiq.com"] as const;

export function isTeamEmail(email: string | null | undefined): boolean {
  const domain = email?.trim().toLowerCase().split("@")[1];
  return Boolean(domain && (TEAM_EMAIL_DOMAINS as readonly string[]).includes(domain));
}

export function isTestStudio(studio: { ownerEmail?: string | null; tags?: string[] | null }): boolean {
  const tags = (studio.tags ?? []).map((tag) => tag.trim().toLowerCase());
  if (tags.includes(REAL_TAG)) return false;
  return tags.includes(TEST_TAG) || isTeamEmail(studio.ownerEmail);
}
