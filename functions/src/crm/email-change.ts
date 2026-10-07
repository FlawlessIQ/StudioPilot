/**
 * What follows a client when the studio changes their email mid-job.
 *
 * GR Productions (2026-10-06): "I changed emails mid job. And now can't resend
 * the proposal to new email." A couple who starts on a work address and moves
 * to a personal one is ordinary. Proposals read the client afresh at send time
 * (booking/proposals.ts); the records below hold a copy of the address that
 * decides who may act, so they are moved with it:
 *
 *  - an agreement nobody has finished signing: its client signer is who must
 *    sign, and signing refuses any other address (server/contracts/client-signing.ts);
 *  - a booking change waiting for the couple's signature, the same way;
 *  - a portal invitation still pending for the old address, which is retired.
 *
 * Anything signed, applied or closed is left exactly as it was. Only a record
 * that names the old address is touched, so a partner's own address is never
 * overwritten.
 */

const normal = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/** A real change of address, both sides present. */
export function emailChanged(before: unknown, after: unknown): boolean {
  const from = normal(before);
  const to = normal(after);
  return Boolean(from && to && from !== to);
}

/** Agreements still waiting on the client: their signer can move. */
const OPEN_CONTRACT = new Set(["draft", "queued", "sent", "delivered", "viewed"]);
/** Booking changes the couple has not signed yet. */
const OPEN_AMENDMENT = new Set(["draft", "queued", "sent", "pending"]);

/**
 * The agreement's signers with the client moved to the new address, or null
 * when this agreement is not one to touch.
 */
export function retargetContractSigners(
  contract: { status?: unknown; signers?: unknown },
  from: string,
  to: string,
): Array<Record<string, unknown>> | null {
  if (!OPEN_CONTRACT.has(String(contract.status ?? ""))) return null;
  if (!Array.isArray(contract.signers)) return null;
  let moved = false;
  const signers = (contract.signers as Array<Record<string, unknown>>).map((signer) => {
    if (
      signer?.role !== "primary_client" ||
      signer.status === "completed" ||
      normal(signer.email) !== normal(from)
    )
      return signer;
    moved = true;
    return { ...signer, email: to };
  });
  return moved ? signers : null;
}

/** Whether a booking change still waits on this client at the old address. */
export function amendmentFollows(
  amendment: { status?: unknown; clientEmail?: unknown },
  from: string,
): boolean {
  return (
    OPEN_AMENDMENT.has(String(amendment.status ?? "")) &&
    normal(amendment.clientEmail) === normal(from)
  );
}

/** A pending invitation to the old address, which no one can accept now. */
export function invitationRetires(
  invitation: { status?: unknown; normalizedEmail?: unknown; email?: unknown },
  from: string,
): boolean {
  return (
    invitation.status === "pending" &&
    normal(invitation.normalizedEmail ?? invitation.email) === normal(from)
  );
}

/**
 * The inquiry side, which the list above missed (GR, 2026-10-07). Albert typed
 * gamil.com on the inquiry form; Gabe corrected it on the client at 11:03 and
 * approved the drafted reply at 11:06 — and it went to gamil.com. The draft
 * held a copy of the address taken when the inquiry arrived, and the inquiry
 * itself still did, so its follow-ups would have gone there too.
 *
 *  - the inquiry (lead) whose couple this is, still at the old address;
 *  - a reply or follow-up waiting for approval, addressed to the old address.
 *
 * The same rule as the rest: only what names the old address moves.
 */

/** A lead still at the old address, belonging to this client. */
export function leadFollows(
  lead: { primaryContactId?: unknown; email?: unknown },
  contactId: string,
  from: string,
): boolean {
  return lead.primaryContactId === contactId && normal(lead.email) === normal(from);
}

/** A draft still waiting for approval that would mail this client's old address. */
export function draftFollows(
  draft: { status?: unknown; structuredOutput?: unknown },
  scope: { contactId: string; leadIds: readonly string[] },
  from: string,
): boolean {
  if (draft.status !== "review_required") return false;
  const output = (draft.structuredOutput ?? {}) as Record<string, unknown>;
  const theirs =
    output.contactId === scope.contactId ||
    (typeof output.leadId === "string" && scope.leadIds.includes(output.leadId));
  return theirs && normal(output.recipientEmail) === normal(from);
}

/**
 * The addresses this client has been corrected away from, newest last. The
 * address they now have is never on it: a correction undone is no longer one.
 */
export function withPreviousEmail(previous: unknown, from: string, to: string): string[] {
  const list = Array.isArray(previous)
    ? previous.map(normal).filter(Boolean)
    : [];
  const old = normal(from);
  const now = normal(to);
  return [...list.filter((item) => item !== old && item !== now), old].slice(-10);
}

/**
 * Who an approved draft goes to, decided as it is approved.
 *
 * The draft's copy wins unless it names an address this client has since been
 * corrected away from — then their address as it is now. A reply drafted to
 * someone else on the thread (a partner, a planner) is never redirected.
 */
export function followedRecipient(
  stored: unknown,
  contact: { email?: unknown; previousEmails?: unknown; archivedAt?: unknown } | null,
): string | null {
  const recipient = typeof stored === "string" ? stored.trim() : "";
  if (!contact || contact.archivedAt) return recipient || null;
  const current = typeof contact.email === "string" ? contact.email.trim() : "";
  const previous = Array.isArray(contact.previousEmails)
    ? contact.previousEmails.map(normal)
    : [];
  if (
    recipient &&
    current &&
    normal(current) !== normal(recipient) &&
    previous.includes(normal(recipient))
  )
    return current;
  return recipient || null;
}
