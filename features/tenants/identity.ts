/**
 * The things a studio calls itself, and what changing them costs.
 *
 * `legalName`, `businessName`, `timezone`, `currency`, `dateFormat` and
 * `publicSlug` were written in exactly one place — `saas/onboarding.ts` — and
 * nowhere else, so they were frozen at signup. A studio that typed its legal
 * name wrong had it on every contract from then on; one that moved cities had
 * every new schedule defaulting to the wrong timezone; and the public inquiry
 * URL was whatever the signup flow generated, `flawlessiq-14313514`, forever.
 *
 * The slug is the one with a real cost attached, so it is treated differently
 * from the rest: see `slugChangeConsequence`.
 *
 * `dateFormat` is deliberately absent. Onboarding writes it and nothing in the
 * product ever reads it, so a control over it would be a setting that does
 * nothing — which is the failure this whole pass has been removing. It belongs
 * here the day date rendering starts honouring it.
 */

export const SUPPORTED_CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD"] as const;
export type StudioIdentity = {
  brandName: string;
  legalName: string;
  businessName: string;
  timezone: string;
  currency: string;
  publicSlug: string;
};

/**
 * The shape a public slug has to take.
 *
 * Matches the guard already in `app/inquiry/page.tsx`
 * (`/^[a-z0-9-]{2,80}$/`) so a slug this accepts is one that page can look up.
 * Tightened at the edges: a leading or trailing hyphen reads as a typo in a URL
 * a studio hands to clients.
 */
export function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

export function slugProblem(slug: string): string | null {
  if (slug.length < 3) return "Use at least three characters.";
  if (slug.length > 60) return "Keep it under sixty characters.";
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return "Use lowercase letters, numbers and hyphens only.";
  }
  if (/^-|-$/.test(slug)) return "Don't start or end with a hyphen.";
  // Reserved because the inquiry page special-cases it for the demo studio.
  if (slug === "demo-studio") return "That address is reserved.";
  return null;
}

/**
 * What a studio needs told before they change their public address.
 *
 * Old links keep working — the tenant keeps every slug it has ever had in
 * `slugAliases`, and the inquiry lookup matches on that — so this is a warning
 * about where the *new* address does and does not appear, not a warning that
 * anything breaks.
 */
export function slugChangeConsequence(
  current: string,
  next: string,
): string | null {
  if (current === next) return null;
  return `Your inquiry form moves to /inquiry?studio=${next}. Links you have already shared with ${current} keep working.`;
}

/**
 * Which changes affect records that already exist, and which do not.
 *
 * Every one of these is a *default* for new records: projects carry their own
 * timezone, package snapshots and invoices carry their own currency, and a
 * signed contract keeps the legal name it was signed under. Saying so is the
 * difference between a studio correcting a typo and a studio afraid to touch
 * their own settings.
 */
export const IDENTITY_SCOPE: Record<keyof StudioIdentity, string> = {
  brandName: "Shown to clients on emails, proposals and their portal.",
  legalName:
    "Used on new agreements. Contracts already signed keep the name they were signed under.",
  businessName: "Your internal name for this workspace.",
  timezone:
    "The default for new jobs. Jobs already booked keep the timezone they were created with.",
  currency:
    "The default for new packages and invoices. Existing prices keep their own currency.",
  publicSlug: "The address of your public inquiry form.",
};
