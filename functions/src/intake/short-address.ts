/**
 * The short forwarding address: `<slug>@<inbound domain>`.
 *
 * The signed address (`inquiries+<slug>.<signature>@…`) is safe because nobody
 * can guess it, and nobody can type it either — studios forwarding by hand
 * had to copy fifty characters each time. The short one is guessable, so it
 * is trusted by who sent the message instead of by a secret in the address:
 *
 *  - the studio's own mailbox, proven by SPF or DKIM (a hand forward, or a
 *    Gmail filter forward, whose envelope sender Gmail rewrites to
 *    `studio+caf_=…@gmail.com`);
 *  - a sender the studio has already confirmed as an inquiry source
 *    (`inquirySenders`), such as a form that emails StudioCue directly.
 *
 * Anything else is still read — never dropped — but lands in "Maybe an
 * inquiry" for the studio to confirm, and never attaches to an existing
 * couple's thread. The signed address keeps working unchanged.
 *
 * Pure. Nothing here reads or writes.
 */

/** Local parts that are ours, or conventional, and can never name a studio. */
export const RESERVED_LOCAL_PARTS = new Set([
  "reply",
  "gallery",
  "inquiries",
  "coi",
  "postmaster",
  "abuse",
  "hostmaster",
  "webmaster",
  "mailer-daemon",
  "noreply",
  "no-reply",
  "admin",
  "support",
  "hello",
  "info",
  "security",
]);

const SLUG = /^[a-z0-9-]{2,80}$/;

function inboundDomain(): string | null {
  const value = process.env.SENDGRID_INBOUND_DOMAIN?.trim().replace(/^@/, "").toLowerCase();
  return value || null;
}

/** The studio's short forwarding address, or null when inbound mail is off. */
export function shortInquiryAddressFor(slug: string, domain = inboundDomain()): string | null {
  if (!domain || !SLUG.test(slug) || RESERVED_LOCAL_PARTS.has(slug)) return null;
  return `${slug}@${domain}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The slug of a short address among these recipients, or null.
 *
 * Only a bare local part counts: `reply+…`, `gallery+…`, `coi+…` and the signed
 * `inquiries+…` all carry a `+` and are routed elsewhere.
 */
export function shortInquirySlugFromRecipients(
  recipients: string,
  domain = inboundDomain(),
): string | null {
  if (!domain) return null;
  const pattern = new RegExp(
    `(?:^|[\\s,<"';:\\[])([a-z0-9-]{2,80})@${escapeRegExp(domain)}(?=$|[\\s,>"';\\]])`,
    "gi",
  );
  for (const match of recipients.matchAll(pattern)) {
    const slug = match[1]!.toLowerCase();
    if (!RESERVED_LOCAL_PARTS.has(slug)) return slug;
  }
  return null;
}

/**
 * An address with any `+tag` removed, lower-cased.
 *
 * Gmail's filter forward sends as `gabe+caf_=<target>@gmail.com`; the mailbox
 * is `gabe@gmail.com`.
 */
export function canonicalMailbox(address: string | null | undefined): string | null {
  const value = address?.trim().toLowerCase();
  if (!value || !value.includes("@")) return null;
  const at = value.lastIndexOf("@");
  const local = value.slice(0, at).split("+")[0];
  const host = value.slice(at + 1);
  return local && host ? `${local}@${host}` : null;
}

const STAFF_ROLES = new Set(["studio_owner", "studio_admin", "studio_coordinator"]);

export type StaffMembership = {
  userId?: unknown;
  role?: unknown;
  status?: unknown;
  email?: unknown;
  normalizedEmail?: unknown;
};

/**
 * The mailboxes of a studio's active owners, admins and coordinators.
 *
 * A membership doesn't always carry an email — the owner's, written at signup,
 * never has — so the user's own verified sign-in address stands in for it.
 * Found on production: GR Productions' owner forwarded an inquiry from the
 * address he signs in with, and it was held as a stranger's because his
 * membership had no email on it. `userEmails` is userId → verified address.
 */
export function staffMailboxes(
  memberships: readonly StaffMembership[],
  userEmails: ReadonlyMap<string, string>,
): string[] {
  const addresses: string[] = [];
  for (const membership of memberships) {
    if (membership.status !== "active" || !STAFF_ROLES.has(String(membership.role))) continue;
    const own = [membership.normalizedEmail, membership.email].find(
      (value): value is string => typeof value === "string" && value.includes("@"),
    );
    const signIn = typeof membership.userId === "string" ? userEmails.get(membership.userId) : undefined;
    for (const address of [own, signIn]) {
      if (address && address.includes("@")) addresses.push(address.trim().toLowerCase());
    }
  }
  return [...new Set(addresses)];
}

/** The staff whose sign-in address is needed: every active staff member. */
export function staffUserIds(memberships: readonly StaffMembership[]): string[] {
  return memberships
    .filter((membership) => membership.status === "active" && STAFF_ROLES.has(String(membership.role)))
    .map((membership) => membership.userId)
    .filter((userId): userId is string => typeof userId === "string" && userId.length > 0);
}

function domainOf(address: string | null): string | null {
  if (!address) return null;
  const at = address.lastIndexOf("@");
  return at > 0 ? address.slice(at + 1).toLowerCase() : null;
}

/**
 * What SendGrid's Inbound Parse checked, read defensively.
 *
 * `SPF` is the result for the envelope sender's domain ("pass", "softfail",
 * …). `dkim` lists each signing domain, e.g. `{@gmail.com : pass}`.
 */
export type InboundAuthentication = { spf: string | null; dkim: string | null };

function spfPasses(auth: InboundAuthentication): boolean {
  return (auth.spf ?? "").trim().toLowerCase() === "pass";
}

export function dkimPassesFor(auth: InboundAuthentication, domain: string | null): boolean {
  if (!domain || !auth.dkim) return false;
  const pattern = new RegExp(`@${escapeRegExp(domain)}\\s*:\\s*pass`, "i");
  return pattern.test(auth.dkim);
}

export type ShortAddressTrust =
  | { trusted: true; reason: "studio_mailbox" | "confirmed_sender" }
  | { trusted: false; reason: string };

/**
 * Whether a message to the short address can be treated as the studio's.
 *
 * `own` is every mailbox that is the studio's (canonical form); `confirmed` is
 * the senders the studio has confirmed as inquiry sources.
 */
export function shortAddressTrust(input: {
  from: string | null;
  envelopeFrom: string | null;
  auth: InboundAuthentication;
  own: readonly string[];
  confirmed: readonly string[];
}): ShortAddressTrust {
  const own = new Set(input.own.map((value) => canonicalMailbox(value)).filter(Boolean) as string[]);
  const from = canonicalMailbox(input.from);
  const envelope = canonicalMailbox(input.envelopeFrom);

  // A filter forward: the envelope sender is the studio's mailbox, and SPF —
  // which is checked against exactly that sender — passed.
  if (envelope && own.has(envelope) && spfPasses(input.auth)) {
    return { trusted: true, reason: "studio_mailbox" };
  }
  // A hand forward: From is the studio, signed by its domain, or sent through
  // an envelope on the same domain that passed SPF.
  if (from && own.has(from)) {
    const fromDomain = domainOf(from);
    if (
      dkimPassesFor(input.auth, fromDomain) ||
      (spfPasses(input.auth) && domainOf(envelope) === fromDomain)
    ) {
      return { trusted: true, reason: "studio_mailbox" };
    }
  }
  // A source the studio already confirmed, authenticated the same way.
  const confirmed = new Set(input.confirmed.map((value) => value.trim().toLowerCase()));
  const rawFrom = input.from?.trim().toLowerCase() ?? null;
  if (rawFrom && confirmed.has(rawFrom)) {
    const fromDomain = domainOf(rawFrom);
    if (
      dkimPassesFor(input.auth, fromDomain) ||
      (spfPasses(input.auth) && domainOf(envelope) === fromDomain)
    ) {
      return { trusted: true, reason: "confirmed_sender" };
    }
  }
  return {
    trusted: false,
    reason: from
      ? `Sent to your StudioCue address from ${from}, which StudioCue doesn't recognise yet.`
      : "Sent to your StudioCue address by a sender StudioCue couldn't verify.",
  };
}
