/**
 * Making a job from a pasted message: who it is for, and what it is called.
 *
 * Found on prod with Jess Styles Bridal (2026-10-12). Priya Shah, a returning
 * client with a portal account for her wedding, asked for hair for her
 * Sangeet. The studio pasted her message into "Tell me about the booking" on
 * New job, and Cue:
 *
 *   - filled "New client" with her details, though her email was already a
 *     client's — creating it would have made her a second contact, with the
 *     new job on that one instead of the record her wedding is on;
 *   - named the job "Priya Shah wedding", from the kind of job, when the
 *     message said what it was: her Sangeet.
 *
 * Pure: the New job form (components/crm/create-project-form.tsx) feeds it
 * the studio's contacts and the read.
 */

import { cleanOccasion } from "@/features/crm/project-prefill";

type Row = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * An email as contacts are matched on it: trimmed and lower-cased, as
 * createContact stores `normalizedEmail`. A plus-address is its own address —
 * "priya+sangeet@" is not "priya@" — because one inbox for two people is how
 * studios test, and how one address ended up as a bride and a crew member
 * (one-address-one-role, 2026-10-08).
 */
export function normalizedEmailOf(value: unknown): string {
  return text(value).toLowerCase();
}

/**
 * The contacts a job can be for: the studio's clients, and the people who
 * inquired and haven't booked yet (a prospect is a client-to-be, and a second
 * record for one is the same duplicate). Never a vendor, venue, planner or
 * anyone else in the address book, and never an archived contact — the job
 * could not be created for one.
 */
export function isClientContact(contact: Row): boolean {
  const types = Array.isArray(contact.contactTypes) ? contact.contactTypes.map(String) : [];
  return !contact.archivedAt && types.some((type) => type === "client" || type === "prospect");
}

/** A contact's name as the form shows it. */
export function contactName(contact: Row): string {
  return (
    text(contact.displayName) ||
    [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(" ") ||
    text(contact.email) ||
    "this client"
  );
}

export type ClientEmailMatch =
  | { kind: "none" }
  | { kind: "one"; contactId: string; name: string; firstName: string; lastName: string }
  | { kind: "several"; count: number }
  /** The address is the studio's own or one of its crew's: never a client to pick. */
  | { kind: "team" };

/**
 * The addresses that are the studio's own people: the crew in its directory
 * (archived crew aside) and whoever is signed in. A client record carrying one
 * of these is a mistake already (one-address-one-role, 2026-10-08), and a job
 * matched onto it would send the client's mail to the team.
 */
export function teamEmailsOf(input: {
  crewProfiles?: readonly Row[] | null;
  userEmail?: unknown;
}): Set<string> {
  const emails = new Set<string>();
  for (const profile of input.crewProfiles ?? []) {
    const email = normalizedEmailOf(profile.email);
    if (email.includes("@") && !profile.archivedAt) emails.add(email);
  }
  const own = normalizedEmailOf(input.userEmail);
  if (own.includes("@")) emails.add(own);
  return emails;
}

/**
 * Which of the studio's clients this email already belongs to: exactly the
 * address, case and spacing aside. Several is an answer too — the studio picks,
 * because choosing one of two people for them is how a job lands on the wrong
 * record. An address on the studio's own team is never matched, whatever
 * record carries it.
 */
export function matchClientByEmail(
  contacts: readonly (Row & { id: string })[] | null | undefined,
  email: unknown,
  teamEmails: ReadonlySet<string> = new Set(),
): ClientEmailMatch {
  const wanted = normalizedEmailOf(email);
  if (!wanted.includes("@")) return { kind: "none" };
  if (teamEmails.has(wanted)) return { kind: "team" };
  const matches = (contacts ?? []).filter(
    (contact) =>
      isClientContact(contact) &&
      [contact.normalizedEmail, contact.email].some((address) => normalizedEmailOf(address) === wanted),
  );
  if (matches.length === 1) {
    const [contact] = matches;
    return {
      kind: "one",
      contactId: contact!.id,
      name: contactName(contact!),
      firstName: text(contact!.firstName),
      lastName: text(contact!.lastName),
    };
  }
  return matches.length > 1 ? { kind: "several", count: matches.length } : { kind: "none" };
}

export type ClientMatchNote = { text: string; warn: boolean };

/**
 * What the form says under "The client" about a match, if anything.
 *
 * On "Existing client", that the read's email picked this client — or that
 * several share it and none was picked. On "New client", that the email typed
 * is already a client's, so a second record is one tap from being made.
 */
export function clientMatchNote(input: {
  mode: "existing" | "new";
  /** The match for the email the read found, once a message has been read. */
  read: ClientEmailMatch | null;
  /** The client chosen on "Existing client". */
  selectedId: string;
  /** The match for the email typed on "New client". */
  typed: ClientEmailMatch;
}): ClientMatchNote | null {
  if (input.mode === "existing") {
    if (input.read?.kind === "one" && input.selectedId === input.read.contactId)
      return {
        text: `Matched by email: ${input.read.name} is already your client, so this job goes on their record. Not them? Choose “New client”.`,
        warn: false,
      };
    if (input.read?.kind === "several" && !input.selectedId)
      return {
        text: `${input.read.count} of your clients use this email, so none was picked for you. Choose who this job is for, or add a new client.`,
        warn: true,
      };
    return null;
  }
  if (input.typed.kind === "team")
    return {
      text: "That email is your own or one of your crew’s, so it can’t be this client’s. Use the client’s own address.",
      warn: true,
    };
  if (input.typed.kind === "one")
    return {
      text: `${input.typed.name} is already your client at this email. Choose “Existing client” to put this job on their record instead of making a second one.`,
      warn: true,
    };
  if (input.typed.kind === "several")
    return {
      text: `${input.typed.count} of your clients already use this email. Choose “Existing client” to pick one instead of making another.`,
      warn: true,
    };
  return null;
}

/**
 * The job's name from what the read found: the people, then the occasion the
 * message names when it names one ("Priya Shah Sangeet"), otherwise the kind
 * of job's own word ("Ava & Liam Chen wedding"), as before. Null without a
 * first name, so the studio names it.
 */
export function jobNameFromRead(read: {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  partnerName: string | null | undefined;
  occasion: string | null | undefined;
  /** vocab(kind).event: "wedding", "session", "event". */
  eventWord: string;
}): string | null {
  const first = text(read.firstName);
  if (!first) return null;
  const partner = text(read.partnerName);
  const last = text(read.lastName);
  const who = `${first}${partner ? ` & ${partner}` : ""}${last ? ` ${last}` : ""}`;
  return `${who} ${cleanOccasion(read.occasion) ?? read.eventWord}`.slice(0, 160);
}

/**
 * The occasion the job keeps for its drafts: only one its name still carries.
 * A studio that renamed "Priya Shah Sangeet" to "Priya Shah wedding" has said
 * what the job is, and a draft must not call it a Sangeet behind its back.
 */
export function occasionKept(occasion: string | null | undefined, jobName: string): string | null {
  const kept = cleanOccasion(occasion);
  return kept && jobName.toLowerCase().includes(kept.toLowerCase()) ? kept : null;
}
