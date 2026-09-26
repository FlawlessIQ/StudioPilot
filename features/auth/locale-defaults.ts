/**
 * What signup can work out instead of asking.
 *
 * Onboarding asked for a timezone (defaulting to New York from 13 options)
 * and a currency (defaulting to USD) — both things the browser already knows
 * well enough to pre-select (docs/onboarding-assessment-2026-09-26.md). The
 * studio can still change either; this only picks the right default.
 */

export const SUPPORTED_CURRENCIES = ["USD", "CAD", "GBP", "EUR", "AUD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

const CANADIAN_ZONES = new Set([
  "America/Toronto",
  "America/Vancouver",
  "America/Edmonton",
  "America/Winnipeg",
  "America/Halifax",
  "America/St_Johns",
  "America/Regina",
  "America/Moncton",
  "America/Whitehorse",
]);

/** The currency a studio in this timezone most likely charges in. */
export function currencyForTimezone(timezone: string): SupportedCurrency {
  if (timezone === "Europe/London" || timezone === "Europe/Belfast") return "GBP";
  if (timezone.startsWith("Europe/")) return "EUR";
  if (timezone.startsWith("Australia/")) return "AUD";
  if (CANADIAN_ZONES.has(timezone)) return "CAD";
  return "USD";
}

/** The browser's timezone, when it names a real one; otherwise null. */
export function detectedTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.includes("/") ? zone : null;
  } catch {
    return null;
  }
}
