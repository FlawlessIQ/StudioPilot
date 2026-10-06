import type { CoverageRole } from "@/features/packages/coverage";

/**
 * The studio's first-call order: who they ask first, per trade.
 *
 * GR Productions (2026-10-06): "How do I order crew members for staffing
 * events? And categorize them by types." Ordering existed only one job at a
 * time, on that job's staffing screen, and the Crew page was one alphabetical
 * list with photographers and videographers mixed. So the Crew page groups
 * people by trade, and each group is an order the studio sets once. Booking's
 * automatic offers and every job's staffing plan follow it
 * (assignCandidatesToRoles' `firstCall`); a job can still be reordered on its
 * own.
 *
 * Stored on the tenant at `crewOffers.firstCall`, one list of crew profile ids
 * per trade. Somebody who works both trades can be first for one and third for
 * the other.
 */

export type FirstCall = Partial<Record<CoverageRole, string[]>>;

export const FIRST_CALL_TRADES: ReadonlyArray<{ trade: CoverageRole; label: string; one: string }> = [
  { trade: "photographer", label: "Photographers", one: "photographer" },
  { trade: "videographer", label: "Videographers", one: "videographer" },
];

const ids = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];

/** The stored order, tidied: unknown trades and duplicates dropped. */
export function readFirstCall(crewOffers: unknown): FirstCall {
  const stored = (crewOffers as { firstCall?: unknown } | null | undefined)?.firstCall;
  if (!stored || typeof stored !== "object") return {};
  const record = stored as Record<string, unknown>;
  const result: FirstCall = {};
  for (const { trade } of FIRST_CALL_TRADES) {
    const list = ids(record[trade]);
    if (list.length) result[trade] = list;
  }
  return result;
}

type Person = { id: string; name?: unknown; trades?: unknown; archivedAt?: unknown };

const tradesOf = (person: Person): string[] =>
  Array.isArray(person.trades) ? person.trades.map((trade) => String(trade).toLowerCase()) : [];

export type TradeGroup<T extends Person> = {
  trade: CoverageRole | null;
  label: string;
  /** In call order: the studio's placed people first, then everyone else by name. */
  people: T[];
  /** How many of `people` the studio has placed; the rest are in name order. */
  placed: number;
};

/**
 * The roster as the Crew page shows it: one group per trade in call order,
 * then the people with no trade yet. Someone with both trades is in both.
 */
export function tradeGroups<T extends Person>(people: readonly T[], firstCall: FirstCall): TradeGroup<T>[] {
  const byName = (left: T, right: T) => String(left.name ?? "").localeCompare(String(right.name ?? ""));
  const groups: TradeGroup<T>[] = FIRST_CALL_TRADES.map(({ trade, label }) => {
    const members = people.filter((person) => tradesOf(person).includes(trade));
    const order = (firstCall[trade] ?? []).filter((id) => members.some((person) => person.id === id));
    const placed = order.map((id) => members.find((person) => person.id === id)!);
    const rest = members.filter((person) => !order.includes(person.id)).sort(byName);
    return { trade, label, people: [...placed, ...rest], placed: placed.length };
  });
  const untyped = people
    .filter((person) => !FIRST_CALL_TRADES.some(({ trade }) => tradesOf(person).includes(trade)))
    .sort(byName);
  return [...groups, { trade: null, label: "No type yet", people: untyped, placed: 0 }];
}

/**
 * The group's full order after moving one person up or down. Everyone in the
 * group is written, so the order on screen is the order saved — including the
 * people who had only been in name order until now.
 */
export function moveInOrder(order: readonly string[], id: string, direction: -1 | 1): string[] {
  const next = [...order];
  const from = next.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= next.length) return next;
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

/** "1st", "2nd", "3rd", "4th"… for "1st call". */
export function ordinal(position: number): string {
  const n = Math.max(1, Math.floor(position));
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}
