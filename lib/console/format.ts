/**
 * How the Console writes numbers, money and time (docs/console.md).
 *
 * Dates are relative in tables ("2h ago", "in 3d") with the exact time on
 * hover; money is whole dollars in tables and cents in records. Pure, so
 * tests/console-format.test.ts pins every case.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function money(cents: number | null | undefined, options: { cents?: boolean } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const showCents = options.cents ?? false;
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US");
}

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${value.toLocaleString("en-US")} ${value === 1 ? one : many}`;
}

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

/** "just now", "12m ago", "3h ago", "4d ago", "in 3d", or a date past a month. */
export function relative(iso: string | null | undefined, now: number = Date.now()): string {
  const at = parse(iso);
  if (at === null) return "—";
  const delta = at - now;
  const span = Math.abs(delta);
  const future = delta > 0;
  let text: string;
  if (span < MINUTE) return future ? "in a moment" : "just now";
  if (span < HOUR) text = `${Math.round(span / MINUTE)}m`;
  else if (span < DAY) text = `${Math.round(span / HOUR)}h`;
  else if (span < 30 * DAY) text = `${Math.round(span / DAY)}d`;
  else return shortDate(iso, now);
  return future ? `in ${text}` : `${text} ago`;
}

/** "12 Mar", or "12 Mar 2025" outside the current year. */
export function shortDate(iso: string | null | undefined, now: number = Date.now()): string {
  const at = parse(iso);
  if (at === null) return "—";
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** "12 Mar 2026, 09:12" — the hover text and record pages. */
export function dateTime(iso: string | null | undefined): string {
  const at = parse(iso);
  if (at === null) return "—";
  return new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Whole days from now to a date; negative in the past. */
export function daysUntil(iso: string | null | undefined, now: number = Date.now()): number | null {
  const at = parse(iso);
  return at === null ? null : Math.ceil((at - now) / DAY);
}

/** `tenant_be3901ee-cfb8-49d5-bc77-2c5992358b42` → `tenant_be39…8b42`. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 18) return id;
  const prefix = id.match(/^[a-z]+_/)?.[0] ?? "";
  const rest = id.slice(prefix.length);
  return `${prefix}${rest.slice(0, 4)}…${rest.slice(-4)}`;
}

/** Two letters for an avatar square. */
export function initials(name: string | null | undefined, fallback = "?"): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{N}\s&]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && word !== "&");
  if (!words.length) return fallback;
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
}

/** Sentence-case a snake/camel identifier for display: "create_consultation_resources" → "Create consultation resources". */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  const spaced = value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Percent of a limit, clamped, for usage bars. */
export function percentOf(value: number, limit: number | null | undefined): number {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / limit) * 100)));
}
