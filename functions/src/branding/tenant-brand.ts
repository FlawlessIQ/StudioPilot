/**
 * Mirror of features/branding/tenant-brand.ts — functions/ is a separate
 * package with no "@/features" path. Compared below the header by
 * tests/tenant-brand.test.ts.
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
export function safeLogoUrl(value: unknown): string | null {
  const url = text(value);
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
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
