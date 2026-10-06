/**
 * Which clients a search on the Clients page finds, and in which tab.
 *
 * The list used to test the query against `displayName` alone, inside the open
 * tab. A studio searching "t14" for conor+t14@flawlessiq.com was told "No
 * clients match", and so was a search for the whole address (2026-10-06). A
 * studio remembers a client by whatever it last saw: the email in the inbox,
 * the number on the phone, the company on the invoice. All of them count.
 */

export type ClientListView = "active" | "prospects" | "archived";

export const clientListViews: readonly ClientListView[] = [
  "active",
  "prospects",
  "archived",
];

/** The fields a contact document may carry; every one is optional on read. */
export type ClientSearchRecord = {
  [field: string]: unknown;
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  normalizedEmail?: unknown;
  phone?: unknown;
  normalizedPhone?: unknown;
  company?: unknown;
  contactTypes?: unknown;
  archivedAt?: unknown;
};

/** An unknown `?view=` is the Active tab, as the page has always treated it. */
export function clientListView(view: string | undefined): ClientListView {
  return view === "archived" || view === "prospects" ? view : "active";
}

/**
 * Whether a contact belongs on a tab. A contact typed as both client and
 * prospect is listed on both, as it always was.
 */
export function inClientListView(
  contact: ClientSearchRecord,
  view: ClientListView,
): boolean {
  const contactTypes = Array.isArray(contact.contactTypes)
    ? contact.contactTypes.map(String)
    : [];
  const archived = Boolean(contact.archivedAt);
  if (view === "archived") return archived;
  if (view === "prospects") return !archived && contactTypes.includes("prospect");
  return !archived && contactTypes.includes("client");
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * A query made only of digits and the marks people put in phone numbers, with
 * enough digits to mean one. "t14" is not a phone number; "555-0187" is.
 */
function phoneDigitsOf(query: string): string | null {
  if (!/^[\d\s()+.-]+$/.test(query)) return null;
  const digits = query.replace(/\D/g, "");
  return digits.length >= 3 ? digits : null;
}

export function clientMatchesSearch(
  contact: ClientSearchRecord,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const phoneDigits = phoneDigitsOf(needle);
  if (phoneDigits) {
    // Stored as "+1 212 555 0187" and typed as "212-555-0187": compare digits.
    const digits = `${text(contact.phone)} ${text(contact.normalizedPhone)}`.replace(/\D/g, "");
    if (digits.includes(phoneDigits)) return true;
  }
  const haystack = [
    contact.displayName,
    contact.firstName,
    contact.lastName,
    contact.email,
    contact.normalizedEmail,
    contact.phone,
    contact.company,
  ]
    .map(text)
    .join("\n")
    .toLowerCase();
  // Every word on its own, anywhere. "Test Pick" finds Pick Test, and an email
  // pasted into the address bar still matches after the browser has read its
  // "+" as a space: "conor t14@flawlessiq.com".
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

export type ClientSearchResult<T> = {
  /** The open tab's matches, in the order given. */
  rows: T[];
  /** Matches the open tab does not list, by the tab that does. */
  elsewhere: { view: ClientListView; count: number }[];
};

export function searchClientList<T extends ClientSearchRecord>(
  contacts: readonly T[],
  view: ClientListView,
  query: string,
): ClientSearchResult<T> {
  const matches = contacts.filter((contact) => clientMatchesSearch(contact, query));
  const rows = matches.filter((contact) => inClientListView(contact, view));
  // Only a search can hide someone in another tab; with no query each tab is
  // simply its own list.
  const elsewhere = query.trim()
    ? clientListViews
        .filter((other) => other !== view)
        .map((other) => ({
          view: other,
          count: matches.filter(
            (contact) =>
              inClientListView(contact, other) &&
              !inClientListView(contact, view),
          ).length,
        }))
        .filter((entry) => entry.count > 0)
    : [];
  return { rows, elsewhere };
}

/** "active clients", "prospects", "archived clients". */
export function clientViewNoun(view: ClientListView): string {
  return view === "prospects" ? "prospects" : `${view} clients`;
}

/** "1 archived client", "2 prospects". */
function clientCount(view: ClientListView, count: number): string {
  const noun = clientViewNoun(view);
  return `${count} ${count === 1 ? noun.slice(0, -1) : noun}`;
}

/**
 * What the Clients list says when the open tab has nobody to show. A search
 * that found people in another tab says where and links there, search kept,
 * instead of reporting that nobody matches.
 */
export function clientListEmptyState(
  view: ClientListView,
  query: string,
  elsewhere: ClientSearchResult<unknown>["elsewhere"],
): { state: string; detail: string; action?: { href: string; label: string } } {
  const q = query.trim();
  if (q && elsewhere.length) {
    const total = elsewhere.reduce((sum, entry) => sum + entry.count, 0);
    const first = elsewhere[0]!;
    return {
      state: `No ${clientViewNoun(view)} match “${q}”`,
      detail: `${elsewhere
        .map((entry) => clientCount(entry.view, entry.count))
        .join(" and ")} ${total === 1 ? "matches" : "match"}.`,
      action: {
        href: `?${new URLSearchParams({ view: first.view, q })}`,
        label: `Show ${clientViewNoun(first.view)}`,
      },
    };
  }
  if (q)
    return {
      state: `No clients match “${q}”`,
      detail: "Try a name, email, phone number or company, or clear the search.",
    };
  return {
    state:
      view === "archived"
        ? "No archived clients"
        : view === "prospects"
          ? "No prospects yet"
          : "No clients yet",
    detail:
      "Add a client directly or convert an inquiry when you are ready to book.",
    action: { href: "/studio/clients/new", label: "Add client" },
  };
}
