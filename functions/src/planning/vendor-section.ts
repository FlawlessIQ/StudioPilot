/**
 * The vendor section of a planner's Final details form
 * (docs/planner-journey-plan.md, N6): one vendor per line.
 *
 * A form has no rows to add, so — like the party list — the couple writes
 * one vendor per line: "Florist — Petal & Stem — Rosa, 908 555 0117 —
 * arriving 1:30 PM". It goes out filled in from the job's vendor team
 * (job-facts.ts, the `vendor_team` fact), so a full-planning couple corrects
 * what the planner already booked, and a month-of couple hands over the
 * vendors they booked themselves. When they send it back, every vendor not
 * already on the team joins it, booked (vendor-team.ts
 * `importVendorsFromForm`).
 *
 * Deterministic: the same words always read the same way, and nothing is
 * guessed by a model. Forgiving on purpose: dashes, tabs, semicolons, pipes
 * or a colon after the kind of vendor; commas only when there is nothing
 * else between the parts. Pure, no imports.
 */

/** The field's id on the recommended form (recommended-templates.ts). */
export const VENDOR_SECTION_FIELD_ID = "vendor-team";

/** The vendor directory's kinds a line can name (features/vendors/schema.ts). */
export type SectionCategory =
  | "venue"
  | "planner"
  | "photographer"
  | "videographer"
  | "florist"
  | "dj"
  | "band"
  | "hair_makeup"
  | "caterer"
  | "bakery"
  | "officiant"
  | "rentals"
  | "entertainment"
  | "choreographer"
  | "transportation"
  | "other";

const CATEGORY_WORDS: ReadonlyArray<[RegExp, SectionCategory]> = [
  [/\bvideo|\bfilm(?:maker|ographer)?\b|\bcinemat/i, "videographer"],
  [/\bphoto(?:grapher|graphy|s)?\b/i, "photographer"],
  [/\bflori(?:st|sts)\b|\bflowers?\b|\bfloral\b/i, "florist"],
  [/\bdj\b|\bdisc jockey\b/i, "dj"],
  [/\bband\b|\bmusicians?\b|\bquartet\b|\btrio\b|\bstrings?\b|\bharpist\b|\bpianist\b|\bceremony music\b/i, "band"],
  [/\bhair\b|\bmake.?up\b|\bmua\b|\bbeauty\b|\bstylist\b/i, "hair_makeup"],
  [/\bcater(?:er|ing)?\b/i, "caterer"],
  [/\bcakes?\b|\bbaker(?:y)?\b|\bdesserts?\b|\bpastry\b/i, "bakery"],
  [/\bofficiant\b|\bcelebrant\b|\bminister\b|\bpastor\b|\bpriest\b|\brabbi\b|\bjustice of the peace\b/i, "officiant"],
  [/\brentals?\b|\btent\b|\blinens?\b|\bchairs?\b|\bdécor rental\b/i, "rentals"],
  // Before "dancers": a quinceañera's choreographer teaches the court's dances.
  [/\bchoreograph/i, "choreographer"],
  [/\bentertain(?:er|ers|ment)\b|\bdancers?\b|\bphoto booth\b|\bgame host\b|\bmagician\b|\bcaricatur/i, "entertainment"],
  [/\btransport(?:ation)?\b|\blimo(?:usine)?\b|\bshuttles?\b|\bbus\b|\bcar service\b/i, "transportation"],
  [/\bplanner\b|\bcoordinator\b/i, "planner"],
  [/\bvenue\b/i, "venue"],
];

/** How each kind is written on a line, as the team names it (features/vendors/team.ts). */
export const SECTION_CATEGORY_WORDS: Record<SectionCategory, string> = {
  venue: "Venue",
  planner: "Planner",
  photographer: "Photographer",
  videographer: "Videographer",
  florist: "Florist",
  dj: "DJ",
  band: "Band",
  hair_makeup: "Hair and makeup",
  caterer: "Caterer",
  bakery: "Cake",
  officiant: "Officiant",
  rentals: "Rentals",
  entertainment: "Entertainment",
  choreographer: "Choreographer",
  transportation: "Transportation",
  other: "Other",
};

const EMAIL = /[^\s@<>(),;]+@[^\s@<>(),;]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;
const ARRIVAL = /\b(?:arriv(?:es|ing|al)?|load(?:s|ing)?[\s-]?in|set(?:ting)?[\s-]?up|from)\s*(?:at|by|:)?\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon)/i;

function categoryOf(text: string): SectionCategory | null {
  return CATEGORY_WORDS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** "1:30 PM", "1:30pm", "noon", "13:30" → "13:30"; an hour alone with no AM or PM is left out. */
export function arrivalClock(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (raw === "noon") return "12:00";
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(raw);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (!match[3] && !match[2]) return null;
  if (match[3] === "pm" && hour < 12) hour += 12;
  if (match[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** "13:30" → "1:30 PM". */
function spoken(clock: string): string {
  const [hour, minute] = clock.split(":").map(Number) as [number, number];
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export type SectionVendor = {
  category: SectionCategory;
  company: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  /** HH:MM on the day, when the line says when they arrive. */
  arrivalTime: string | null;
};

/** The vendors on the section, one per line. Lines naming no company (a heading, "TBD") are skipped. */
export function parseVendorSection(value: unknown): SectionVendor[] {
  if (typeof value !== "string") return [];
  const vendors: SectionVendor[] = [];
  for (const raw of value.split(/\r?\n/).slice(0, 60)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
    if (!line || /^[^—–\-:;|\t]+:\s*$/.test(line)) continue;
    const email = EMAIL.exec(line)?.[0] ?? null;
    const phone = PHONE.exec(line.replace(EMAIL, " "))?.[0]?.trim() ?? null;
    const arrival = ARRIVAL.exec(line);
    const arrivalTime = arrival ? arrivalClock(arrival[1]!) : null;
    // "Florist: Petal & Stem" names the kind before a colon.
    const colon = /^([^:]{2,40}):\s*(.+)$/.exec(line);
    const body = colon && categoryOf(colon[1]!) ? `${colon[1]} — ${colon[2]}` : line;
    const separated = /\s[—–-]\s|\t|;|\|/.test(body);
    const parts = body
      .split(separated ? /\s+[—–-]\s+|\t|\s*;\s*|\s*\|\s*/ : /\s*,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    let category: SectionCategory | null = null;
    let company = "";
    const contact: string[] = [];
    for (const part of parts) {
      const plain = part.replace(EMAIL, "").replace(PHONE, "").replace(ARRIVAL, "").replace(/[,\s]+$/, "").replace(/^[,\s]+/, "").trim();
      const kind = categoryOf(part);
      // The kind of vendor on its own ("Florist", "Our DJ", "DJ (Dinner and
      // dancing)"): the category.
      if (!category && kind && plain.replace(/\([^)]*\)/g, "").trim().split(/\s+/).length <= 3 && !company) {
        category = kind;
        continue;
      }
      if (!plain) continue;
      if (!company) company = plain;
      else contact.push(plain);
    }
    if (!company || /^(?:tbd|tba|n\/?a|none|not yet|not booked)$/i.test(company)) continue;
    vendors.push({
      category: category ?? categoryOf(line) ?? "other",
      company: company.slice(0, 200),
      contactName: contact.join(", ").slice(0, 160),
      email,
      phone,
      arrivalTime,
    });
  }
  return vendors;
}

/** The fields of a team entry a line is written from. */
export type SectionEntry = {
  [key: string]: unknown;
  category?: unknown;
  roleLabel?: unknown;
  status?: unknown;
  company?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  arrivalTime?: unknown;
  archivedAt?: unknown;
  removedByClientAt?: unknown;
};

const words = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The section as the team stands: every vendor booked or being considered,
 * one per line, in the same shape the couple is asked to write. A category
 * still needed, with nobody chosen, is left for them to fill in.
 */
export function vendorSectionLines(entries: readonly SectionEntry[]): string {
  return entries
    // Not one the couple took off their list: the section is read back to them.
    .filter(
      (entry) =>
        !entry.archivedAt && !entry.removedByClientAt && (entry.status === "booked" || entry.status === "considering") && words(entry.company),
    )
    .map((entry) => {
      // The kind first, so the line reads back as the same vendor: "DJ (Dinner and dancing)".
      const category = SECTION_CATEGORY_WORDS[words(entry.category) as SectionCategory] || "Vendor";
      const kind = words(entry.roleLabel) ? `${category} (${words(entry.roleLabel)})` : category;
      const contact = [words(entry.contactName), words(entry.phone), words(entry.email)].filter(Boolean).join(", ");
      const clock = /^\d{2}:\d{2}$/.test(words(entry.arrivalTime)) ? `arriving ${spoken(words(entry.arrivalTime))}` : "";
      return [kind, words(entry.company), contact, clock].filter(Boolean).join(" — ");
    })
    .join("\n");
}

/** A company's name as compared: case, punctuation and "the" set aside. */
export function companyKey(value: unknown): string {
  return words(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * The vendors on the section the team doesn't have yet: matched by email, or
 * by company name (case, punctuation and "the" set aside). What came from the team itself
 * (the prefill) always matches, so sending it back unchanged adds nobody.
 */
export function vendorsToImport(section: readonly SectionVendor[], team: readonly SectionEntry[]): SectionVendor[] {
  const current = team.filter((entry) => !entry.archivedAt);
  const known = (vendor: SectionVendor) =>
    current.some((entry) => {
      const email = words(entry.email).toLowerCase();
      if (vendor.email && email && vendor.email.toLowerCase() === email) return true;
      return companyKey(entry.company) !== "" && companyKey(entry.company) === companyKey(vendor.company);
    });
  const seen = new Set<string>();
  return section.filter((vendor) => {
    const key = companyKey(vendor.company);
    if (!key || seen.has(key) || known(vendor)) return false;
    seen.add(key);
    return true;
  });
}
