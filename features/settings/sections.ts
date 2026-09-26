/**
 * Studio settings, section by section.
 *
 * Each section is its own page at /studio/settings/<slug>, reached from the
 * hub at /studio/settings. It used to be one long page of every panel, where
 * "Inquiry capture" sat 3,600px down; a studio had to scroll past five other
 * panels to find it. Plain data so the server route can validate a slug and
 * name the page without importing the (client) panels.
 */

export type SettingsSectionKey =
  | "identity"
  | "branding"
  | "availability"
  | "templates"
  | "drafts"
  | "forwarding"
  | "crewOffers"
  | "data";

export const SETTINGS_SECTIONS: ReadonlyArray<{
  key: SettingsSectionKey;
  slug: string;
  title: string;
  subtitle: string;
}> = [
  { key: "identity", slug: "studio-details", title: "Studio details", subtitle: "Name, logo, and how clients see you" },
  { key: "branding", slug: "email-branding", title: "Email branding", subtitle: "Colours and sender name on client emails" },
  { key: "availability", slug: "consultation-availability", title: "Consultation availability", subtitle: "When clients can book a call" },
  { key: "templates", slug: "email-templates", title: "Email templates", subtitle: "Design the branded template" },
  { key: "drafts", slug: "automatic-drafts", title: "Automatic drafts", subtitle: "Which lifecycle emails are drafted for you" },
  { key: "forwarding", slug: "inquiry-capture", title: "Inquiry capture", subtitle: "Website form, inbox, or forward by hand" },
  { key: "crewOffers", slug: "crew-offers", title: "Crew offers", subtitle: "Whether booking sends the prepared offers, or you do" },
  { key: "data", slug: "data", title: "Data & account", subtitle: "Export your data or request deletion" },
];

export function settingsSectionHref(key: SettingsSectionKey): string {
  const section = SETTINGS_SECTIONS.find((item) => item.key === key)!;
  return `/studio/settings/${section.slug}`;
}

export function settingsSectionBySlug(slug: string) {
  return SETTINGS_SECTIONS.find((item) => item.slug === slug) ?? null;
}

/**
 * Links written before sections had pages: `?section=<key>` (Today and Leads)
 * and `#<panel id>` anchors (setup gaps). The hub forwards them on.
 */
export function legacySettingsTarget(search: string, hash: string): string | null {
  const key = new URLSearchParams(search).get("section");
  const byKey = SETTINGS_SECTIONS.find((item) => item.key === key);
  if (byKey) return `/studio/settings/${byKey.slug}`;
  const anchor = hash.replace(/^#/, "");
  const byAnchor: Record<string, SettingsSectionKey> = {
    "consultation-availability": "availability",
    "inquiry-capture": "forwarding",
  };
  return byAnchor[anchor] ? settingsSectionHref(byAnchor[anchor]) : null;
}
