/**
 * Place helpers with no runtime dependencies.
 *
 * Split from ./schema.ts so the public inquiry form (components/crm/
 * lead-intake-form.tsx, components/forms/address-field.tsx) can use them
 * without pulling Zod into a couple's phone — Zod was a 265 KB chunk of that
 * page (H5). ./schema.ts re-exports these, so other callers are unchanged.
 */
import type { CapturedPlace } from "./schema";

/**
 * A place from free text, unverified.
 *
 * The honest representation of "they typed something we could not match":
 * keep the words, admit we did not confirm them.
 */
export function unverifiedPlace(text: string): CapturedPlace | null {
  const formatted = text.trim().replace(/\s+/g, " ");
  if (!formatted) return null;
  return {
    placeId: null,
    formatted: formatted.slice(0, 500),
    name: null,
    line1: null,
    city: null,
    region: null,
    postalCode: null,
    country: null,
    latitude: null,
    longitude: null,
    verified: false,
  };
}

/**
 * The one-line label for a captured place.
 *
 * Prefers the venue's name over its street, because "The Ryland Inn" is
 * what a photographer calls it and "115 Old Highway 28" is not.
 */
export function placeLabel(place: CapturedPlace | null): string {
  if (!place) return "";
  return place.name?.trim() || place.formatted;
}

/**
 * The city a captured place sits in, for the fields that only want that.
 *
 * Falls back to parsing the formatted line so an unverified entry still
 * fills the city box rather than leaving it empty.
 */
export function placeCity(place: CapturedPlace | null): string | null {
  if (!place) return null;
  if (place.city) return place.city;
  const parts = place.formatted.split(",").map((part) => part.trim());
  // "Name, 115 Old Highway 28, Whitehouse Station, NJ 08889, USA" — the
  // city is the part before the one carrying a postal code or country.
  return parts.length >= 3 ? (parts.at(-3) ?? null) : null;
}

