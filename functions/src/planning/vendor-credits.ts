/**
 * The vendor credits: every vendor who made the wedding, for the couple to
 * share (docs/planner-journey-plan.md, N7).
 *
 * After the day, couples post their photos and a blog or magazine asks who
 * did what; a planner sends the list — category, name, website or Instagram —
 * and credits herself first (Style Me Pretty: "credit every vendor,
 * including yourself"). It is read from the vendor team, so nobody types it.
 * The studio presses "Send vendor credits"; nothing sends it on its own.
 * Pure, no imports.
 */

export type CreditEntry = {
  [key: string]: unknown;
  vendorId?: unknown;
  status?: unknown;
  archivedAt?: unknown;
  category?: unknown;
  roleLabel?: unknown;
  company?: unknown;
};

export type CreditVendor = { website?: unknown; company?: unknown; archivedAt?: unknown };

export type CreditLine = { category: string; company: string; website: string | null };

/** The order a credit list is read in: where, who planned it, who captured it, then everyone else. */
const ORDER = [
  "venue",
  "planner",
  "photographer",
  "videographer",
  "florist",
  "caterer",
  "bakery",
  "dj",
  "band",
  "hair_makeup",
  "officiant",
  "rentals",
  "entertainment",
  "choreographer",
  "transportation",
  "other",
];

const LABELS: Record<string, string> = {
  venue: "Venue",
  planner: "Planning",
  photographer: "Photography",
  videographer: "Videography",
  florist: "Florals",
  caterer: "Catering",
  bakery: "Cake",
  dj: "DJ",
  band: "Music",
  hair_makeup: "Hair and makeup",
  officiant: "Officiant",
  rentals: "Rentals",
  entertainment: "Entertainment",
  choreographer: "Choreographer",
  transportation: "Transportation",
  other: "Also",
};

const words = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** "https://www.petalandstem.com/" → "petalandstem.com"; an Instagram handle stays "@petalandstem". */
export function creditLink(value: unknown): string | null {
  const raw = words(value);
  if (!raw) return null;
  const instagram = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(raw);
  if (instagram) return `@${instagram[1]}`;
  if (/^@[A-Za-z0-9._]+$/.test(raw)) return raw;
  return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "") || null;
}

/**
 * The credit list: the studio first, then every booked vendor in the usual
 * order, each with its website when the directory has one. Vendors not
 * booked (needed, considering, declined) and anyone archived are left off.
 */
export function vendorCredits(input: {
  entries: readonly CreditEntry[];
  vendors: ReadonlyMap<string, CreditVendor>;
  /** The studio itself, credited first under its own work ("Planning"). */
  studio: { name: string; website?: unknown; category: string };
}): CreditLine[] {
  const rank = (category: string) => {
    const index = ORDER.indexOf(category);
    return index < 0 ? ORDER.length : index;
  };
  const booked = input.entries
    .filter((entry) => !entry.archivedAt && entry.status === "booked")
    .map((entry) => {
      const vendor = input.vendors.get(words(entry.vendorId));
      const category = words(entry.category) || "other";
      return {
        rank: rank(category),
        line: {
          category: words(entry.roleLabel) || LABELS[category] || "Also",
          company: words(vendor?.company) || words(entry.company),
          website: creditLink(vendor?.website),
        },
      };
    })
    .filter((item) => item.line.company)
    .sort((left, right) => left.rank - right.rank || left.line.company.localeCompare(right.line.company))
    .map((item) => item.line);
  const studio = words(input.studio.name);
  return [...(studio ? [{ category: input.studio.category, company: studio, website: creditLink(input.studio.website) }] : []), ...booked];
}

/** "Florals: Petal & Stem (petalandstem.com)". */
export function creditLineText(line: CreditLine): string {
  return `${line.category}: ${line.company}${line.website ? ` (${line.website})` : ""}`;
}
