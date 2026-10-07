import { clientMatchesSearch } from "@/features/contacts/client-search";
import type { InquiryRow } from "@/features/inquiries/pipeline";

/**
 * Which inquiries a search finds, and in which tab.
 *
 * The same faults the Clients search had (features/contacts/client-search.ts,
 * 2026-10-06), found on the Inquiries list the same day: the tabs linked to
 * `?view=…` and dropped the search, the box kept its old words after an
 * in-app visit, and "No inquiries in this view" was all a studio was told when
 * the couple they wanted had simply closed. Matching is the Clients rule —
 * every word, anywhere in the name or email, and an email whose "+" the
 * address bar turned into a space still matches.
 */

export type InquiryView = "open" | "new" | "talking" | "consult" | "proposal" | "signing" | "closed";

export function inInquiryView(row: Pick<InquiryRow, "stage">, view: string): boolean {
  return view === "open" ? row.stage !== "closed" : row.stage === view;
}

export function inquiryMatchesSearch(row: Pick<InquiryRow, "name" | "email">, query: string): boolean {
  return clientMatchesSearch({ displayName: row.name, email: row.email }, query);
}

/**
 * The open tab's matches, and — when the search finds people elsewhere — where.
 * "Open" already holds every stage, so a stage tab points at Open and Closed,
 * and Open points at Closed.
 */
export function searchInquiries<T extends Pick<InquiryRow, "name" | "email" | "stage">>(
  rows: readonly T[],
  view: string,
  query: string,
): { rows: T[]; elsewhere: Array<{ view: "open" | "closed"; count: number }> } {
  const matching = rows.filter((row) => inquiryMatchesSearch(row, query));
  const here = matching.filter((row) => inInquiryView(row, view));
  if (!query.trim()) return { rows: here, elsewhere: [] };
  const others: Array<"open" | "closed"> = view === "open" ? ["closed"] : view === "closed" ? ["open"] : ["open", "closed"];
  const elsewhere = others
    .map((other) => ({
      view: other,
      count: matching.filter((row) => inInquiryView(row, other) && !inInquiryView(row, view)).length,
    }))
    .filter((entry) => entry.count > 0);
  return { rows: here, elsewhere };
}

const VIEW_NOUN: Record<string, string> = {
  open: "open inquiries",
  new: "new inquiries",
  talking: "inquiries you're talking with",
  consult: "inquiries at the consultation",
  proposal: "inquiries with a proposal out",
  signing: "inquiries at signing",
  closed: "closed inquiries",
};

/** What an empty list says while searching; null when not searching. */
export function inquirySearchEmptyState(
  view: string,
  query: string,
  elsewhere: Array<{ view: "open" | "closed"; count: number }>,
): { state: string; detail: string; action?: { href: string; label: string } } | null {
  const q = query.trim();
  if (!q) return null;
  if (elsewhere.length) {
    const first = elsewhere[0]!;
    const counts = elsewhere
      .map((entry) => `${entry.count} ${entry.view} ${entry.count === 1 ? "inquiry" : "inquiries"}`)
      .join(" and ");
    const total = elsewhere.reduce((sum, entry) => sum + entry.count, 0);
    return {
      state: `No ${VIEW_NOUN[view] ?? "inquiries"} match “${q}”`,
      detail: `${counts} ${total === 1 ? "matches" : "match"}.`,
      action: { href: `?${new URLSearchParams({ view: first.view, q })}`, label: `Show ${VIEW_NOUN[first.view]}` },
    };
  }
  return { state: `No inquiries match “${q}”`, detail: "Try a name or email, or clear the search." };
}
