/**
 * The payments and tips a planner hands out on the day, from the vendor team
 * (docs/planner-journey-plan.md, N7).
 *
 * Planners carry labeled envelopes: the balance the couple still owes each
 * vendor on the day, and each vendor's tip. Both are already on the team
 * (features/vendors/team.ts: `balanceDueCents` + `balanceDueDate`,
 * `tipCents`), so the list is read, never typed again. A balance due before
 * the day is the couple's to pay ahead and is left off; one due on the day,
 * or with no date, is handed over.
 *
 * Shown on the day's journey step and in the crew's reminder email the day
 * before. Pure, no imports. Mirrored at functions/src/planning/hand-out.ts;
 * tests/planner-journey.test.ts compares the two below the marker.
 */
// ── mirrored below ──

export type HandOutEntry = {
  [key: string]: unknown;
  status?: unknown;
  archivedAt?: unknown;
  removedByClientAt?: unknown;
  company?: unknown;
  category?: unknown;
  roleLabel?: unknown;
  balanceDueCents?: unknown;
  balanceDueDate?: unknown;
  tipCents?: unknown;
  arrivalTime?: unknown;
  loadInTime?: unknown;
  createdAt?: unknown;
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
 * on the day (or undated) or a tip, in the order they arrive (as the contact
 * sheet lists them), so the envelopes go out as the vendors walk in. The
 * team's own order breaks a tie; anyone with no time comes last.
 */
export function paymentsToHandOut(entries: readonly HandOutEntry[], eventDate: string | null | undefined): HandOut {
  const day = words(eventDate).slice(0, 10);
  const lines: HandOutLine[] = [];
  const arrives = (entry: HandOutEntry) => words(entry.arrivalTime) || words(entry.loadInTime) || "99:99";
  const ordered = entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => arrives(left.entry).localeCompare(arrives(right.entry)) || words(left.entry.createdAt).localeCompare(words(right.entry.createdAt)) || left.index - right.index)
    .map(({ entry }) => entry);
  for (const entry of ordered) {
    // Taken off by the couple (kept for the studio to decide): no envelope.
    if (entry.archivedAt || entry.removedByClientAt || entry.status !== "booked") continue;
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
