import { z } from "zod";

/**
 * Addresses, captured rather than typed.
 *
 * Venue and city were free-text boxes. A studio that types "The Ryland Inn"
 * on one job, "Ryland Inn" on the next and "ryland inn, whitehouse station"
 * on a third has three venues as far as the product is concerned, and the
 * certificate of insurance that goes to the venue is only as good as
 * whatever was in the box. Anything that wants to group by venue, drive to
 * it, or put it on a legal document needs the real thing.
 *
 * Two shapes: a `PlaceSuggestion` is what the provider offers while someone
 * types, and a `CapturedPlace` is what gets stored once they choose. They
 * are separate because a suggestion is disposable and a captured place is a
 * record — the provider's own id is kept so the same venue resolves the
 * same way next year.
 */

export const placeSuggestionSchema = z.object({
  /** The provider's stable identifier for this place. */
  placeId: z.string().min(1).max(400),
  /** The bold part: "The Ryland Inn". */
  primary: z.string().min(1).max(300),
  /** The rest: "Whitehouse Station, NJ, USA". Empty for a bare locality. */
  secondary: z.string().max(400).default(""),
});

export type PlaceSuggestion = z.infer<typeof placeSuggestionSchema>;

export const capturedPlaceSchema = z.object({
  /**
   * Null when someone typed an address the provider could not match and
   * kept it anyway — which must stay possible. A barn with no listing is
   * still a venue, and refusing to accept it would be worse than storing
   * it unverified.
   */
  placeId: z.string().max(400).nullable().default(null),
  /** The whole thing on one line, as the reader should see it. */
  formatted: z.string().min(1).max(500),
  /** The venue's own name, when the place has one distinct from its street. */
  name: z.string().max(300).nullable().default(null),
  line1: z.string().max(300).nullable().default(null),
  city: z.string().max(160).nullable().default(null),
  /** State, province, or equivalent. */
  region: z.string().max(160).nullable().default(null),
  postalCode: z.string().max(40).nullable().default(null),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2).nullable().default(null),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
  /**
   * False when the text was kept without choosing a suggestion. Anything
   * that depends on the address being real — a COI, a map link, a drive
   * time — must check this rather than assume.
   */
  verified: z.boolean().default(false),
});

export type CapturedPlace = z.infer<typeof capturedPlaceSchema>;

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

/** Google's address component types, in the order we care about them. */
const COMPONENT_FIELDS: Array<[keyof CapturedPlace, string[]]> = [
  ["city", ["locality", "postal_town", "sublocality"]],
  ["region", ["administrative_area_level_1"]],
  ["postalCode", ["postal_code"]],
];

type GoogleComponent = {
  longText?: string | null;
  shortText?: string | null;
  types?: string[] | null;
};

/**
 * Normalise a Google Place into our own shape.
 *
 * Kept here, in the pure layer, so it is testable without a network and so
 * swapping providers later means writing one more function rather than
 * touching every caller.
 */
export function fromGooglePlace(place: {
  id?: string | null;
  displayName?: { text?: string | null } | null;
  formattedAddress?: string | null;
  shortFormattedAddress?: string | null;
  addressComponents?: GoogleComponent[] | null;
  location?: { latitude?: number | null; longitude?: number | null } | null;
}): CapturedPlace | null {
  const formatted =
    place.formattedAddress?.trim() ||
    place.shortFormattedAddress?.trim() ||
    place.displayName?.text?.trim();
  if (!formatted) return null;

  const components = place.addressComponents ?? [];
  const pick = (types: string[]): string | null => {
    const match = components.find((component) =>
      (component.types ?? []).some((type) => types.includes(type)),
    );
    return match?.longText?.trim() || null;
  };

  const streetNumber = pick(["street_number"]);
  const route = pick(["route"]);
  const line1 =
    [streetNumber, route].filter(Boolean).join(" ").trim() || null;

  const countryComponent = components.find((component) =>
    (component.types ?? []).includes("country"),
  );
  const country = countryComponent?.shortText?.trim().toUpperCase() ?? null;

  const resolved: Record<string, string | null> = {};
  for (const [field, types] of COMPONENT_FIELDS) {
    resolved[field as string] = pick(types);
  }

  const name = place.displayName?.text?.trim() || null;
  return {
    placeId: place.id?.trim() || null,
    formatted,
    // A pure street address comes back with its own address as the display
    // name; repeating it as a venue name would be noise.
    name: name && name !== formatted && name !== line1 ? name : null,
    line1,
    city: resolved.city ?? null,
    region: resolved.region ?? null,
    postalCode: resolved.postalCode ?? null,
    country: country && country.length === 2 ? country : null,
    latitude:
      typeof place.location?.latitude === "number"
        ? place.location.latitude
        : null,
    longitude:
      typeof place.location?.longitude === "number"
        ? place.location.longitude
        : null,
    verified: true,
  };
}
