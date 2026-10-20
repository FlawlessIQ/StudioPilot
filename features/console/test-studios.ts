/**
 * Which studios are ours. The Console's Studios list hides them by default so
 * real customers are what you see (Conor, 2026-10-20). A studio is a test when
 * its owner signs in with a StudioCue team address, or someone tagged it
 * "test"; a "real" tag wins over the address, for a teammate's genuine studio.
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
