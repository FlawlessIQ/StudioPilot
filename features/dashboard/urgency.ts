/**
 * Urgency ranking for the studio home page.
 *
 * The attention queue used to concatenate by *type* — inquiries, then
 * approvals, then exceptions — and cap the result at five. Four inquiries
 * therefore pushed every AI approval and every exception off the list
 * entirely, which is how a queue titled "only the decisions that need you"
 * ended up hiding the overdue balance.
 *
 * Ranking here is by how much the studio stands to lose by not acting, and
 * every bucket competes on the same scale.
 */

import { daysUntilEvent, eventDateHasPassed } from "@/lib/format/event-date";

export type UrgencyKind = "exception" | "approval" | "inquiry";

export type RankableItem = {
  id: string;
  kind: UrgencyKind;
  title: string;
  detail: string;
  href: string;
  /** ISO date of the event this item concerns, when it has one. */
  eventDate?: string | null;
  /** ISO timestamp of when the item last changed. */
  updatedAt?: string | null;
  /** Set for money-bearing items so a large balance outranks a small one. */
  amountCents?: number | null;
};

export type RankedItem = RankableItem & { score: number };

/**
 * Base weight per kind. Exceptions lead because something has already gone
 * wrong; approvals are work the studio can clear in one tap; inquiries are
 * revenue that has not been lost yet but decays fastest with silence.
 */
const kindWeight: Record<UrgencyKind, number> = {
  exception: 1000,
  approval: 600,
  inquiry: 500,
};

/**
 * Event proximity dominates within a kind: an event this week outranks one
 * next quarter. A date that has already passed is the strongest signal
 * available — it means the work slipped.
 */
export function proximityWeight(
  eventDate: string | null | undefined,
  now: Date,
): number {
  if (!eventDate) return 0;
  if (eventDateHasPassed(eventDate, now)) return 500;
  const days = daysUntilEvent(eventDate, now);
  if (days === null) return 0;
  if (days <= 3) return 400;
  if (days <= 7) return 300;
  if (days <= 14) return 200;
  if (days <= 30) return 100;
  return 25;
}

/** An inquiry that has sat unanswered for days is close to lost. */
export function stalenessWeight(
  updatedAt: string | null | undefined,
  now: Date,
): number {
  if (!updatedAt) return 0;
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) return 0;
  const days = Math.floor((now.valueOf() - parsed) / 86_400_000);
  if (days <= 0) return 0;
  return Math.min(days, 7) * 20;
}

/** Larger outstanding money breaks ties, but never outranks a kind. */
export function amountWeight(amountCents: number | null | undefined): number {
  const cents = Number(amountCents ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.min(Math.round(cents / 100_000), 50);
}

export function urgencyScore(item: RankableItem, now: Date): number {
  return (
    kindWeight[item.kind] +
    proximityWeight(item.eventDate, now) +
    stalenessWeight(item.updatedAt, now) +
    amountWeight(item.amountCents)
  );
}

/**
 * Ranks every bucket on one scale and returns the most urgent `limit` items.
 * Ties fall back to the most recently touched, so the list is stable rather
 * than arbitrary.
 */
export function rankByUrgency(
  items: readonly RankableItem[],
  options: { now: Date; limit?: number },
): RankedItem[] {
  const scored = items.map((item) => ({
    ...item,
    score: urgencyScore(item, options.now),
  }));
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
  });
  return typeof options.limit === "number" ? scored.slice(0, options.limit) : scored;
}

/**
 * Ranks by urgency but reserves one slot for each kind that has items.
 *
 * Pure urgency ordering has a failure mode of its own: exceptions always
 * outrank, so a studio with five exceptions sees a queue of five exceptions
 * and no sign of the seven drafts it could clear in a tap, or the inquiries
 * that are revenue. Urgency still decides the order and fills the remaining
 * slots — this only guarantees that no whole category is invisible.
 */
export function rankWithRepresentation(
  items: readonly RankableItem[],
  options: { now: Date; limit: number },
): RankedItem[] {
  const ranked = rankByUrgency(items, { now: options.now });
  if (ranked.length <= options.limit) return ranked;

  const picked: RankedItem[] = [];
  const seen = new Set<string>();

  // One slot per kind, taken in urgency order within that kind.
  for (const kind of ["exception", "approval", "inquiry"] as const) {
    const best = ranked.find((item) => item.kind === kind && !seen.has(item.id));
    if (best && picked.length < options.limit) {
      picked.push(best);
      seen.add(best.id);
    }
  }

  // Remaining slots go to whatever is most urgent overall.
  for (const item of ranked) {
    if (picked.length >= options.limit) break;
    if (seen.has(item.id)) continue;
    picked.push(item);
    seen.add(item.id);
  }

  // Restore global urgency order so the list still reads top-down by severity.
  picked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
  });
  return picked;
}

/**
 * Whether every kind that has items is represented in the ranked head.
 *
 * The old queue could silently drop a whole category. This lets the UI notice
 * when that is happening and say so, instead of pretending the list is
 * complete.
 */
export function omittedKinds(
  all: readonly RankableItem[],
  shown: readonly RankedItem[],
): UrgencyKind[] {
  const shownKinds = new Set(shown.map((item) => item.kind));
  const allKinds = new Set(all.map((item) => item.kind));
  return [...allKinds].filter((kind) => !shownKinds.has(kind));
}
