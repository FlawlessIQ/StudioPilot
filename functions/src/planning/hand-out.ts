/**
 * Payments and tips to hand out: the functions copy of
 * features/vendors/hand-out.ts, which explains it. Identical below the marker;
 * tests/planner-journey.test.ts compares the two.
 */
// ── mirrored below ──

export type HandOutEntry = {
  [key: string]: unknown;
  status?: unknown;
  archivedAt?: unknown;
  company?: unknown;
  category?: unknown;
  roleLabel?: unknown;
  balanceDueCents?: unknown;
  balanceDueDate?: unknown;
  tipCents?: unknown;
};

export type HandOutLine = {
  who: string;
  balanceCents: number;
  tipCents: number;
  totalCents: number;
};

export type HandOut = {
  lines: HandOutLine[];
  balanceCents: number;
  tipCents: number;
  totalCents: number;
};

const words = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** "Florist" for "florist", "Hair and makeup" for "hair_makeup". */
function categoryWords(category: unknown): string {
  const raw = words(category).replace(/_/g, " ");
  if (raw === "hair makeup") return "Hair and makeup";
  if (raw === "dj") return "DJ";
  if (raw === "bakery") return "Cake";
  return raw ? `${raw.charAt(0).toUpperCase()}${raw.slice(1)}` : "Vendor";
}

/**
 * Who gets an envelope, and what is in it: booked vendors with a balance due
 * on the day (or undated) or a tip, in the order the team lists them.
 */
export function paymentsToHandOut(entries: readonly HandOutEntry[], eventDate: string | null | undefined): HandOut {
  const day = words(eventDate).slice(0, 10);
  const lines: HandOutLine[] = [];
  for (const entry of entries) {
    if (entry.archivedAt || entry.status !== "booked") continue;
    const due = words(entry.balanceDueDate).slice(0, 10);
    // Due before the day: the couple pays it ahead, not from an envelope.
    const onTheDay = !due || !day || due >= day;
    const balanceCents = onTheDay ? amount(entry.balanceDueCents) : 0;
    const tipCents = amount(entry.tipCents);
    if (!balanceCents && !tipCents) continue;
    const company = words(entry.company);
    const role = words(entry.roleLabel) || categoryWords(entry.category);
    lines.push({ who: company ? `${company} (${role})` : role, balanceCents, tipCents, totalCents: balanceCents + tipCents });
  }
  const sum = (pick: (line: HandOutLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  return { lines, balanceCents: sum((line) => line.balanceCents), tipCents: sum((line) => line.tipCents), totalCents: sum((line) => line.totalCents) };
}

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** "Petal & Stem (Florist): balance $1,200 and tip $100". */
export function handOutLineText(line: HandOutLine): string {
  const parts = [line.balanceCents ? `balance ${dollars(line.balanceCents)}` : "", line.tipCents ? `tip ${dollars(line.tipCents)}` : ""].filter(Boolean);
  return `${line.who}: ${parts.join(" and ")}`;
}

/** "3 payments and tips to hand out, $1,550", or null when there are none. */
export function handOutSummary(handOut: HandOut): string | null {
  const count = handOut.lines.length;
  if (!count) return null;
  return `${count} ${count === 1 ? "envelope" : "envelopes"} to hand out, ${dollars(handOut.totalCents)}`;
}
