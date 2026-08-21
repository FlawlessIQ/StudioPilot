import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  capturedPlaceSchema,
  fromGooglePlace,
  placeCity,
  placeLabel,
  unverifiedPlace,
} from "@/features/places/schema";

const RYLAND = {
  id: "ChIJryland",
  displayName: { text: "The Ryland Inn" },
  formattedAddress: "115 Old Hwy 28, Whitehouse Station, NJ 08889, USA",
  location: { latitude: 40.6151, longitude: -74.7657 },
  addressComponents: [
    { longText: "115", shortText: "115", types: ["street_number"] },
    { longText: "Old Highway 28", shortText: "Old Hwy 28", types: ["route"] },
    {
      longText: "Whitehouse Station",
      shortText: "Whitehouse Station",
      types: ["locality", "political"],
    },
    {
      longText: "New Jersey",
      shortText: "NJ",
      types: ["administrative_area_level_1"],
    },
    { longText: "United States", shortText: "US", types: ["country"] },
    { longText: "08889", shortText: "08889", types: ["postal_code"] },
  ],
};

test("a Google place becomes a captured place", () => {
  const place = fromGooglePlace(RYLAND);
  assert.ok(place);
  assert.equal(capturedPlaceSchema.safeParse(place).success, true);
  assert.equal(place.name, "The Ryland Inn");
  assert.equal(place.line1, "115 Old Highway 28");
  assert.equal(place.city, "Whitehouse Station");
  assert.equal(place.region, "New Jersey");
  assert.equal(place.postalCode, "08889");
  // Two letters, uppercase — the schema will not take "United States".
  assert.equal(place.country, "US");
  assert.equal(place.verified, true);
});

test("a plain street address does not invent a venue name", () => {
  // Google returns the address itself as the display name for a house.
  // Repeating it as a venue name would put it on screen twice.
  const place = fromGooglePlace({
    ...RYLAND,
    displayName: { text: "115 Old Hwy 28, Whitehouse Station, NJ 08889, USA" },
  });
  assert.equal(place?.name, null);
});

test("a place with no address at all is refused", () => {
  assert.equal(fromGooglePlace({ id: "x" }), null);
  assert.equal(fromGooglePlace({}), null);
});

test("a locality resolves without a street", () => {
  const place = fromGooglePlace({
    id: "ChIJbrooklyn",
    displayName: { text: "Brooklyn" },
    formattedAddress: "Brooklyn, NY, USA",
    addressComponents: [
      { longText: "Brooklyn", shortText: "Brooklyn", types: ["locality"] },
      { longText: "New York", shortText: "NY", types: ["administrative_area_level_1"] },
      { longText: "United States", shortText: "US", types: ["country"] },
    ],
  });
  assert.equal(place?.line1, null);
  assert.equal(place?.city, "Brooklyn");
  assert.equal(place?.postalCode, null);
});

test("an unmatched address is kept, marked unverified", () => {
  // A barn on a family farm has no listing. Refusing it would be worse
  // than storing it unconfirmed.
  const place = unverifiedPlace("  Hensley  family   barn, off Route 9  ");
  assert.ok(place);
  assert.equal(place.verified, false);
  assert.equal(place.placeId, null);
  // Whitespace normalised, words untouched.
  assert.equal(place.formatted, "Hensley family barn, off Route 9");
  assert.equal(capturedPlaceSchema.safeParse(place).success, true);
});

test("empty text is not a place", () => {
  assert.equal(unverifiedPlace(""), null);
  assert.equal(unverifiedPlace("   "), null);
});

test("the label prefers the venue's name over its street", () => {
  // "The Ryland Inn" is what a photographer calls it. "115 Old Highway 28"
  // is not.
  assert.equal(placeLabel(fromGooglePlace(RYLAND)), "The Ryland Inn");
  assert.equal(placeLabel(unverifiedPlace("A barn")), "A barn");
  assert.equal(placeLabel(null), "");
});

test("the city falls out of an unverified line when it can", () => {
  assert.equal(placeCity(fromGooglePlace(RYLAND)), "Whitehouse Station");
  assert.equal(
    placeCity(unverifiedPlace("The Barn, 12 Lane, Red Hook, NY 12571, USA")),
    "Red Hook",
  );
  assert.equal(placeCity(unverifiedPlace("A barn")), null);
  assert.equal(placeCity(null), null);
});

test("latitude and longitude survive only when they are numbers", () => {
  const place = fromGooglePlace({
    ...RYLAND,
    location: { latitude: null, longitude: undefined },
  });
  assert.equal(place?.latitude, null);
  assert.equal(place?.longitude, null);
});

test("the functions copy of the venue schema still matches this one", () => {
  // functions/ is a separate package with no "@/features" path, so
  // createProject re-declares the captured place inline. Nothing but this
  // keeps the two in step, and a drift means a venue silently stripped by
  // Zod on the way into Firestore.
  const command = readFileSync("functions/src/crm/commands.ts", "utf8");
  const block = /venue: z\s*\n?\s*\.object\(\{([\s\S]*?)\}\)/.exec(command);
  assert.ok(block, "createProject no longer declares a venue object");

  const declared = [...block[1].matchAll(/^\s{10}(\w+):/gm)].map(
    (match) => match[1],
  );
  const expected = Object.keys(capturedPlaceSchema.shape);
  assert.deepEqual(
    declared.sort(),
    expected.sort(),
    "features/places/schema.ts and functions/src/crm/commands.ts disagree",
  );
});
