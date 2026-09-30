/**
 * The studio as a couple or crew member should see it: name, colour, logo.
 *
 * Couples see the studio's brand, not StudioCue's (decided 2026-09-28,
 * docs/mobile-first-client-crew-plan-2026-09-28.md). The fields have moved
 * over time: Settings → Branding writes `brandName` and
 * `emailBranding.{primaryColor, logoUrl}`, while older tenants carry
 * `brandColors.primary`, `brandAccentColor`, `logoUrl` or `logo`. Emails
 * already read the whole chain (functions/src/operations/jobs.ts); the client
 * invitation page read only the old fields, so a logo saved in Settings never
 * reached it. Every surface now resolves the brand here.
 *
 * Pure, and mirrored at functions/src/branding/tenant-brand.ts (compared by
 * tests/tenant-brand.test.ts).
 */

export type TenantBrand = {
  brandName: string;
  /** A #RRGGBB colour, or null for the default. Clamp with studioTheme() before use. */
  primaryColor: string | null;
  /** An https URL, or null for the studio's initial. */
  logoUrl: string | null;
};

type TenantData = Record<string, unknown> | null | undefined;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nested(data: TenantData, key: string, field: string): unknown {
  const inner = data?.[key];
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>)[field] : undefined;
}

export function safeBrandColor(value: unknown): string | null {
  const color = text(value);
  if (!color) return null;
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color);
  if (!match) return null;
  const hex = match[1]!.length === 3
    ? match[1]!.split("").map((digit) => digit + digit).join("")
    : match[1]!;
  return `#${hex.toUpperCase()}`;
}

/** https only: a logo is shown on pages served over https and in email. */
/**
 * The storage service whose *page* this link is, or null. Dropbox previews,
 * Drive, iCloud and the rest share pages, not images: GR Productions' logo was
 * a Dropbox preview behind Dropbox's sign-in, and showed as a broken image on
 * its form, emails and portal (2026-09-30). A public Dropbox share link with
 * `raw=1` does serve the image, so that one passes.
 */
export function logoPageService(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "dropbox.com") {
    const shared = /^\/(s|scl\/fi)\//.test(url.pathname);
    return shared && url.searchParams.get("raw") === "1" ? null : "Dropbox";
  }
  if (host === "drive.google.com" || host === "docs.google.com") return "Google Drive";
  if (host === "photos.google.com" || host === "photos.app.goo.gl") return "Google Photos";
  if (host.endsWith("icloud.com")) return "iCloud";
  if (host === "onedrive.live.com" || host === "1drv.ms" || host.endsWith("sharepoint.com")) return "OneDrive";
  if (host === "canva.com" || host.endsWith(".canva.com")) return "Canva";
  return null;
}

export function safeLogoUrl(value: unknown): string | null {
  const url = text(value);
  if (!url) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  // A page is not an image: the studio's initial beats a broken picture.
  return logoPageService(url) ? null : url;
}

export function resolveTenantBrand(data: TenantData, fallbackName = "Your studio"): TenantBrand {
  return {
    brandName:
      text(data?.brandName) ??
      text(nested(data, "emailBranding", "brandName")) ??
      text(data?.businessName) ??
      fallbackName,
    primaryColor:
      safeBrandColor(nested(data, "emailBranding", "primaryColor")) ??
      safeBrandColor(nested(data, "brandColors", "primary")) ??
      safeBrandColor(data?.brandAccentColor),
    logoUrl:
      safeLogoUrl(nested(data, "emailBranding", "logoUrl")) ??
      safeLogoUrl(data?.logoUrl) ??
      safeLogoUrl(data?.logo),
  };
}
