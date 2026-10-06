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
