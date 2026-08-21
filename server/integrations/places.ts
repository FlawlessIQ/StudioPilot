import {
  fromGooglePlace,
  placeSuggestionSchema,
  type CapturedPlace,
  type PlaceSuggestion,
} from "@/features/places/schema";

/**
 * Address lookup, behind the same shape as every other provider here.
 *
 * Live mode calls the Google Places API (New) over REST rather than loading
 * Google's JavaScript widget. Three reasons, in order: the API key never
 * reaches the browser, the client bundle does not grow by a third-party
 * map library, and the response is normalised once in
 * `features/places/schema.ts` instead of everywhere a widget is mounted.
 *
 * Mock mode contacts nothing and returns a small deterministic set, so the
 * emulator, the tests and any deployment without a key all behave the same
 * way — and visibly so, since the UI discloses it.
 */
export type PlacesProvider = {
  readonly live: boolean;
  suggest(input: {
    query: string;
    /** Bias results toward this ISO-3166 country when set. */
    country?: string | null;
    /** Groups a user's keystrokes into one billable session. */
    sessionToken?: string | null;
  }): Promise<PlaceSuggestion[]>;
  resolve(input: {
    placeId: string;
    sessionToken?: string | null;
  }): Promise<CapturedPlace | null>;
};

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/** Only what we normalise, so Google bills the cheapest field mask it can. */
const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "location",
].join(",");

class GooglePlacesProvider implements PlacesProvider {
  readonly live = true;
  constructor(private readonly apiKey: string) {}

  async suggest({
    query,
    country,
    sessionToken,
  }: {
    query: string;
    country?: string | null;
    sessionToken?: string | null;
  }): Promise<PlaceSuggestion[]> {
    const response = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        input: query,
        ...(country ? { includedRegionCodes: [country.toLowerCase()] } : {}),
        ...(sessionToken ? { sessionToken } : {}),
      }),
      // A suggestion that arrives after the next keystroke is worthless;
      // failing fast keeps a slow provider from holding the field open.
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`PLACES_SUGGEST_FAILED_${response.status}`);
    const payload = (await response.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
          text?: { text?: string };
        };
      }>;
    };
    return (payload.suggestions ?? [])
      .map((entry) => entry.placePrediction)
      .filter((prediction) => prediction?.placeId)
      .map((prediction) =>
        placeSuggestionSchema.safeParse({
          placeId: prediction?.placeId,
          primary:
            prediction?.structuredFormat?.mainText?.text ??
            prediction?.text?.text ??
            "",
          secondary: prediction?.structuredFormat?.secondaryText?.text ?? "",
        }),
      )
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  }

  async resolve({
    placeId,
    sessionToken,
  }: {
    placeId: string;
    sessionToken?: string | null;
  }): Promise<CapturedPlace | null> {
    const url = new URL(`${DETAILS_URL}/${encodeURIComponent(placeId)}`);
    if (sessionToken) url.searchParams.set("sessionToken", sessionToken);
    const response = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": DETAIL_FIELDS,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`PLACES_RESOLVE_FAILED_${response.status}`);
    return fromGooglePlace(await response.json());
  }
}

/**
 * A handful of venues and towns, matched on substring.
 *
 * Deliberately recognisable as demo data — a studio seeing "Whitehouse
 * Station" offered for every query should be able to tell at a glance that
 * nothing real is being looked up, which is what the disclosure in the UI
 * says too.
 */
const MOCK_PLACES: CapturedPlace[] = [
  {
    placeId: "mock-ryland-inn",
    formatted: "The Ryland Inn, 115 Old Highway 28, Whitehouse Station, NJ 08889, USA",
    name: "The Ryland Inn",
    line1: "115 Old Highway 28",
    city: "Whitehouse Station",
    region: "New Jersey",
    postalCode: "08889",
    country: "US",
    latitude: 40.6151,
    longitude: -74.7657,
    verified: true,
  },
  {
    placeId: "mock-park-savoy",
    formatted: "The Park Savoy Estate, 236 Ridgedale Ave, Florham Park, NJ 07932, USA",
    name: "The Park Savoy Estate",
    line1: "236 Ridgedale Ave",
    city: "Florham Park",
    region: "New Jersey",
    postalCode: "07932",
    country: "US",
    latitude: 40.7809,
    longitude: -74.3888,
    verified: true,
  },
  {
    placeId: "mock-liberty-house",
    formatted: "Liberty House Restaurant, 76 Audrey Zapp Dr, Jersey City, NJ 07305, USA",
    name: "Liberty House Restaurant",
    line1: "76 Audrey Zapp Dr",
    city: "Jersey City",
    region: "New Jersey",
    postalCode: "07305",
    country: "US",
    latitude: 40.7038,
    longitude: -74.0533,
    verified: true,
  },
  {
    placeId: "mock-new-york",
    formatted: "New York, NY, USA",
    name: null,
    line1: null,
    city: "New York",
    region: "New York",
    postalCode: null,
    country: "US",
    latitude: 40.7128,
    longitude: -74.006,
    verified: true,
  },
  {
    placeId: "mock-brooklyn",
    formatted: "Brooklyn, NY, USA",
    name: null,
    line1: null,
    city: "Brooklyn",
    region: "New York",
    postalCode: null,
    country: "US",
    latitude: 40.6782,
    longitude: -73.9442,
    verified: true,
  },
];

class MockPlacesProvider implements PlacesProvider {
  readonly live = false;

  async suggest({ query }: { query: string }): Promise<PlaceSuggestion[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    return MOCK_PLACES.filter((place) =>
      `${place.name ?? ""} ${place.formatted}`.toLowerCase().includes(needle),
    )
      .slice(0, 5)
      .map((place) => ({
        placeId: place.placeId ?? "",
        primary: place.name ?? place.city ?? place.formatted,
        secondary: place.name
          ? [place.line1, place.city, place.region].filter(Boolean).join(", ")
          : [place.region, place.country].filter(Boolean).join(", "),
      }));
  }

  async resolve({ placeId }: { placeId: string }): Promise<CapturedPlace | null> {
    return MOCK_PLACES.find((place) => place.placeId === placeId) ?? null;
  }
}

/**
 * The provider for this deployment.
 *
 * `GOOGLE_PLACES_API_KEY` is server-only on purpose — it is never prefixed
 * `NEXT_PUBLIC_`, and the only things that read it are this module and the
 * Cloud Function behind the public inquiry form. A browser key restricted
 * by HTTP referrer would be simpler and is still a key anyone can lift off
 * the page and spend.
 */
export function placesProvider(): PlacesProvider {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const mode = process.env.PROVIDER_MODE?.trim();
  if (apiKey && mode !== "mock") return new GooglePlacesProvider(apiKey);
  return new MockPlacesProvider();
}
