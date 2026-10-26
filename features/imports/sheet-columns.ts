import { tradeOf } from "@/features/trades/trades";

/**
 * What a spreadsheet column holds, read from its header *and* its cells.
 *
 * The importer used to match headers alone, by substring: "Lead
 * Photographer" (a column of names) became the photographer *count* and
 * blocked every row with `Couldn't read the number of photographers "Gabe"`;
 * "Assistant Names" contains "name" and became the client, so a hair studio's
 * wedding imported under "Kim Tara, Joy" without a word; "Second Shooter",
 * "Assistants", "DJ" and "Video" were ignored or misread
 * (docs/import-bookings-review-2026-10-26.md).
 *
 * So a column is placed in two steps:
 *  1. Its header, by whole words. A header naming a crew role ("Second
 *     Shooter", "Assistants", "Hair Stylists", "DJ") is a crew column, and
 *     never a client column whatever else it says.
 *  2. Its cells: whether they are counts, yes/no, people's names, times.
 *     A crew column of names records who worked the job (and so how many);
 *     a count is how many; Yes is one.
 *
 * Pure: no I/O. Roles are the coverage roles (features/packages/coverage.ts).
 */

export type CrewRole =
  | "photographer"
  | "videographer"
  | "photo_assistant"
  | "dj"
  | "dj_assistant"
  | "makeup_artist"
  | "makeup_assistant"
  | "hair_stylist"
  | "hair_assistant"
  | "coordinator";

/**
 * The roles this studio itself sends, so a wedding sheet's "DJ" column (the
 * couple's DJ, a vendor) is never a photographer's crew. A beauty studio
 * often sends both trades, so makeup and hair each read the other's roles.
 */
export function importCrewRoles(trade: unknown): readonly CrewRole[] {
  switch (tradeOf(trade)) {
    case "dj":
      return ["dj", "dj_assistant"];
    case "makeup":
      return ["makeup_artist", "makeup_assistant", "hair_stylist", "hair_assistant"];
    case "hair":
      return ["hair_stylist", "hair_assistant", "makeup_artist", "makeup_assistant"];
    case "planner":
      return ["coordinator"];
    default:
      return ["photographer", "videographer", "photo_assistant"];
  }
}

/** What a column's cells are. */
export type CellKind = "empty" | "count" | "flag" | "names" | "time" | "other";

const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/[_\-.:/()#*?,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether `phrase` appears in `header` as whole words. */
export function hasWords(header: string, phrase: string): boolean {
  return ` ${words(header)} `.includes(` ${words(phrase)} `);
}

/**
 * The crew role a header names, in this studio's trade. Longest phrase first,
 * so "DJ Assistant" is the DJ's assistant, not the DJ, and "Second Shooter"
 * is a photographer. A bare "Assistant" is the studio's own assistant role.
 */
export function crewRoleFromHeader(header: string, trade: unknown): { role: CrewRole; extra: boolean } | null {
  const own = tradeOf(trade);
  const assistant: CrewRole =
    own === "dj" ? "dj_assistant" : own === "makeup" ? "makeup_assistant" : own === "hair" ? "hair_assistant" : own === "planner" ? "coordinator" : "photo_assistant";
  const phrases: Array<[string, CrewRole, boolean?]> = [
    // A second shooter is a photographer; the column adds to the count.
    ["second shooter", "photographer", true],
    ["2nd shooter", "photographer", true],
    ["second photographer", "photographer", true],
    ["2nd photographer", "photographer", true],
    ["photo assistant", "photo_assistant"],
    ["photography assistant", "photo_assistant"],
    ["lighting assistant", "photo_assistant"],
    ["dj assistant", "dj_assistant"],
    ["dj tech", "dj_assistant"],
    ["lighting tech", "dj_assistant"],
    ["sound tech", "dj_assistant"],
    ["roadie", "dj_assistant"],
    ["makeup assistant", "makeup_assistant"],
    ["mua assistant", "makeup_assistant"],
    ["hair assistant", "hair_assistant"],
    ["stylist assistant", "hair_assistant"],
    ["assistant coordinator", "coordinator"],
    ["day of coordinator", "coordinator"],
    ["coordinator", "coordinator"],
    ["assistant", assistant],
    ["assistants", assistant],
    ["videographer", "videographer"],
    ["videographers", "videographer"],
    ["cinematographer", "videographer"],
    ["cinematographers", "videographer"],
    ["filmmaker", "videographer"],
    ["video", "videographer"],
    ["videos", "videographer"],
    ["photographer", "photographer"],
    ["photographers", "photographer"],
    ["shooter", "photographer"],
    ["shooters", "photographer"],
    ["photog", "photographer"],
    ["makeup artist", "makeup_artist"],
    ["makeup artists", "makeup_artist"],
    ["mua", "makeup_artist"],
    ["hair stylist", "hair_stylist"],
    ["hair stylists", "hair_stylist"],
    ["hairstylist", "hair_stylist"],
    ["dj", "dj"],
    ["djs", "dj"],
    ["disc jockey", "dj"],
  ];
  // A beauty studio's bare "Stylist" or "Artist" is its own role.
  if (own === "hair") phrases.push(["stylist", "hair_stylist"], ["stylists", "hair_stylist"]);
  if (own === "makeup") phrases.push(["artist", "makeup_artist"], ["artists", "makeup_artist"]);
  const sorted = [...phrases].sort((a, b) => b[0].length - a[0].length);
  const allowed = importCrewRoles(trade);
  for (const [phrase, role, extra] of sorted) {
    if (!hasWords(header, phrase)) continue;
    // The first (longest) phrase decides: "DJ Assistant" in a photographer's
    // sheet is the couple's vendor, not the studio's photo assistant.
    return allowed.includes(role) ? { role, extra: Boolean(extra) } : null;
  }
  return null;
}

const FLAG_YES = /^(y|yes|true|x|✓|✔|included|booked)$/i;
const FLAG_NO = /^(n|no|false|none|-|—|n\/a|na|0)$/i;
const TIME = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i;

/** What the non-empty cells of a column look like. */
export function cellKind(cells: readonly string[]): CellKind {
  const values = cells.map((cell) => cell.trim()).filter(Boolean);
  if (!values.length) return "empty";
  if (values.every((value) => /^\d{1,2}$/.test(value))) return "count";
  if (values.every((value) => FLAG_YES.test(value) || FLAG_NO.test(value))) return "flag";
  if (values.every((value) => TIME.test(value) && /[:apAP]/.test(value))) return "time";
  // People: letters, spaces, apostrophes and hyphens, perhaps a list. A count
  // in front ("2 (Kim, Tara)") still reads as names.
  if (values.every((value) => /[a-z]/i.test(value) && /^[\d\s(]*[a-z][a-z\s'’.\-,&/+;()]*$/i.test(value))) return "names";
  return "other";
}

/** "Kim, Tara & Joy", "Kim/Tara", "2 (Kim, Tara)" → ["Kim", "Tara", "Joy"]. */
export function namesFrom(cell: string): string[] {
  return cell
    .replace(/^\s*\d+\s*/, "")
    .replace(/[()]/g, " ")
    .split(/\s*(?:,|&|\/|\+|;|\band\b)\s*/i)
    .map((name) => name.trim())
    .filter((name) => /[a-z]/i.test(name) && !FLAG_NO.test(name) && !FLAG_YES.test(name));
}

/** A crew cell, read by the column's kind: how many, and who if it says. */
export function readCrewCell(cell: string, kind: CellKind): { count: number; names: string[] } | { problem: string } {
  const value = cell.trim();
  if (!value) return { count: 0, names: [] };
  if (FLAG_NO.test(value)) return { count: 0, names: [] };
  if (FLAG_YES.test(value)) return { count: 1, names: [] };
  if (/^\d{1,2}$/.test(value)) return { count: Number(value), names: [] };
  if (kind === "names" || kind === "other") {
    const names = namesFrom(value);
    const stated = /^\s*(\d+)/.exec(value);
    if (names.length) return { count: Math.max(names.length, stated ? Number(stated[1]) : 0), names };
  }
  return { problem: `Couldn't read "${value}"` };
}

/** "7:00 AM", "14:30", "7am" → "07:00", "14:30". Null when it isn't a time. */
export function readTime(cell: string): string | null {
  const match = TIME.exec(cell.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]?.toLowerCase().replace(/\./g, "");
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || (!meridiem && !match[2])) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
