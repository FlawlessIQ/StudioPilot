import { tradeOf } from "@/features/trades/trades";

/**
 * The extras a studio of each trade adds most: one tap starts one, and the
 * studio names the price (nothing is invented). `perUnit` names what it is
 * priced per (unit-label.ts): a bridesmaid's makeup per person, a touch-up
 * stay per hour. Null is a single extra.
 *
 * A photographer's are the extras the add-on editor always offered; a DJ's,
 * a makeup artist's and a hair stylist's are from docs/vendor-journeys.md.
 */
export type ExtraIdea = { name: string; description: string; perUnit: string | null };

const PHOTOGRAPHER: readonly ExtraIdea[] = [
  { name: "Engagement shoot", description: "", perUnit: null },
  { name: "Photo booth", description: "", perUnit: null },
  { name: "Boudoir session", description: "", perUnit: null },
  { name: "Extra hour of coverage", description: "", perUnit: null },
  { name: "Second shooter", description: "", perUnit: null },
  { name: "Rehearsal dinner", description: "", perUnit: null },
  { name: "Parent albums", description: "", perUnit: null },
];

const DJ: readonly ExtraIdea[] = [
  { name: "Ceremony sound", description: "Wireless microphones for the officiant and readers, and the ceremony music.", perUnit: null },
  { name: "Cocktail hour music", description: "Music in a second room while the reception is set.", perUnit: null },
  { name: "Uplighting", description: "Colored lighting around the room.", perUnit: null },
  { name: "Monogram light", description: "Your names or initials lit on the dance floor or a wall.", perUnit: null },
  { name: "Extra hour", description: "Another hour of music, booked ahead.", perUnit: "hour" },
];

const MAKEUP: readonly ExtraIdea[] = [
  { name: "Bridesmaid makeup", description: "Full makeup for each bridesmaid.", perUnit: "person" },
  { name: "Mother of the bride makeup", description: "Full makeup for the mothers and grandmothers.", perUnit: "person" },
  { name: "Flower girl makeup", description: "A light touch for the flower girls.", perUnit: "person" },
  { name: "Lashes", description: "Strip or cluster lashes, applied.", perUnit: "person" },
  { name: "Airbrush makeup", description: "Airbrushed foundation, for a finish that lasts all day.", perUnit: "person" },
  { name: "Touch-up stay", description: "Your artist stays for touch-ups until the ceremony.", perUnit: "hour" },
  { name: "Travel", description: "Travel to the getting-ready location.", perUnit: null },
  { name: "Early start", description: "For a start before 7:00 AM.", perUnit: null },
  { name: "Extra artist", description: "Another artist, so a larger party is ready on time.", perUnit: "artist" },
];

const HAIR: readonly ExtraIdea[] = [
  { name: "Bridesmaid hair", description: "Styling for each bridesmaid.", perUnit: "person" },
  { name: "Mother of the bride hair", description: "Styling for the mothers and grandmothers.", perUnit: "person" },
  { name: "Flower girl hair", description: "Simple styling for the flower girls.", perUnit: "person" },
  { name: "Veil placement", description: "Your veil and accessories placed and secured.", perUnit: null },
  { name: "Clip-in extension install", description: "Your own clip-in extensions, blended in.", perUnit: "person" },
  { name: "Extension rental", description: "Color-matched extensions for the day, returned after.", perUnit: "person" },
  { name: "Touch-up stay", description: "Your stylist stays for touch-ups until the ceremony.", perUnit: "hour" },
  { name: "Travel", description: "Travel to the getting-ready location.", perUnit: null },
  { name: "Early start", description: "For a start before 7:00 AM.", perUnit: null },
];

const BY_TRADE = { photographer: PHOTOGRAPHER, dj: DJ, makeup: MAKEUP, hair: HAIR } as const;

export function extraIdeasFor(trade: unknown): readonly ExtraIdea[] {
  return BY_TRADE[tradeOf(trade)];
}
