/**
 * Who a thread is with, by name.
 *
 * A thread's participant name is whatever the last writer knew. The client
 * portal wrote the sender's sign-in name, or their email when the account
 * had none — and a later message's name replaces an earlier one, so Priya
 * Shah's wedding thread was listed as "conor+priya@flawlessiq.com" while her
 * inquiry thread, written from the form, said "Priya Shah" (Jess Styles
 * Bridal, prod walk 2026-10-12). The studio already knows her: she is a
 * contact, by that email.
 *
 * So a participant's own name is used when it is a name, then the studio's
 * contact with that id or email, then the name another thread with the same
 * email carries. An email is never a name. Pure, browser-safe.
 */

type Participant = {
  contactId?: string | null;
  email?: string | null;
  name?: string | null;
};

/** A contact record as read from Firestore: only the fields this needs. */
export type NamedContact = {
  id?: unknown;
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  normalizedEmail?: unknown;
  archivedAt?: unknown;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** "someone@example.com", with or without a display wrapper. */
export function looksLikeEmail(value: unknown): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text(value).replace(/^<|>$/g, ""));
}

/** The value when it names a person: not blank, and not an email address. */
export function personName(value: unknown): string | null {
  const name = text(value);
  return name && !looksLikeEmail(name) ? name : null;
}

const emailKey = (value: unknown): string => text(value).toLowerCase();

function contactName(contact: NamedContact): string | null {
  return (
    personName(contact.displayName) ??
    personName(`${text(contact.firstName)} ${text(contact.lastName)}`.trim())
  );
}

/**
 * A function naming a participant, built once per list of threads.
 *
 * Archived contacts are used only when no live one has the email: a client
 * re-added after an archive keeps their current name.
 */
export function threadNamer(input: {
  threads?: readonly { participant: Participant }[] | null;
  contacts?: readonly NamedContact[] | null;
}): (participant: Participant) => string | null {
  const byId = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const archivedByEmail = new Map<string, string>();
  for (const contact of input.contacts ?? []) {
    const name = contactName(contact);
    if (!name) continue;
    const id = text(contact.id);
    if (id) byId.set(id, name);
    const archived = Boolean(contact.archivedAt);
    for (const email of [emailKey(contact.normalizedEmail), emailKey(contact.email)]) {
      if (!email) continue;
      const target = archived ? archivedByEmail : byEmail;
      if (!target.has(email)) target.set(email, name);
    }
  }
  const fromThreads = new Map<string, string>();
  for (const thread of input.threads ?? []) {
    const email = emailKey(thread.participant.email);
    const name = personName(thread.participant.name);
    if (email && name && !fromThreads.has(email)) fromThreads.set(email, name);
  }
  return (participant) => {
    const own = personName(participant.name);
    if (own) return own;
    const id = text(participant.contactId);
    if (id && byId.has(id)) return byId.get(id)!;
    const email = emailKey(participant.email);
    if (!email) return null;
    return byEmail.get(email) ?? archivedByEmail.get(email) ?? fromThreads.get(email) ?? null;
  };
}

/** Whether any of these threads would need the contacts to be named. */
export function threadsNeedContactNames(
  threads: readonly { participant?: Participant | null }[] | null | undefined,
): boolean {
  return (threads ?? []).some(
    (thread) => !personName(thread.participant?.name) && Boolean(text(thread.participant?.email)),
  );
}
