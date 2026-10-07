import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";

/**
 * Minting a client portal invitation, in one place.
 *
 * Two callers need identical invitations: the studio inviting a client by
 * hand from the Clients page, and sending a proposal to a client who has
 * no portal access yet. The id is derived from tenant, project and email
 * so both produce the *same* invitation document for the same client on
 * the same job — a proposal sent after a manual invite refreshes that
 * invitation rather than creating a rival one with a second live token.
 */
export type MintedInvitation = {
  invitationId: string;
  /** The secret. Goes in the email link and is never stored. */
  token: string;
  /** What the invitation document stores instead of the token. */
  tokenHash: string;
  inviteUrl: string;
  expiresAt: string;
  email: string;
};

export const hashToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const normalizeInviteEmail = (value: string) =>
  value.trim().toLowerCase();

export const invitationIdFor = (
  tenantId: string,
  projectId: string,
  email: string,
) =>
  `client_invite_${hashToken(`${tenantId}:${projectId}:${email}`).slice(0, 32)}`;

export function mintClientInvitation(input: {
  tenantId: string;
  projectId: string;
  email: string;
  appUrl: string;
  /** Where the client should land once the invitation is accepted. */
  next?: string;
}): MintedInvitation {
  const email = normalizeInviteEmail(input.email);
  const token = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({ token });
  if (input.next) query.set("next", input.next);
  return {
    invitationId: invitationIdFor(input.tenantId, input.projectId, email),
    token,
    tokenHash: hashToken(token),
    inviteUrl: `${input.appUrl}/auth/client-invite?${query.toString()}`,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    email,
  };
}

/**
 * Every link to one invitation keeps working until it expires or is revoked.
 *
 * One document per client per job, and each send minted a new secret over the
 * last: an invite, the proposal, the agreement, a reminder — each one quietly
 * killed the link in every email before it. Albert opened GR's invite at 11:18
 * on 2026-10-07 and got "Invitation unavailable": Gabe had sent it twice, two
 * seconds apart, and the second had replaced the first. `tokenHash` is still
 * the newest; `tokenHashes` holds every link sent since the last revocation.
 */
export function invitationLinkFields(tokenHash: string) {
  return { tokenHash, tokenHashes: FieldValue.arrayUnion(tokenHash) };
}

/**
 * For a write that replaces the whole document: the links that stay live. A
 * revoked invitation starts again from the new one.
 */
export function liveInvitationLinks(
  existing: { status?: unknown; tokenHash?: unknown; tokenHashes?: unknown } | undefined,
  tokenHash: string,
): string[] {
  if (!existing || existing.status === "revoked") return [tokenHash];
  const earlier = Array.isArray(existing.tokenHashes)
    ? existing.tokenHashes.filter((item): item is string => typeof item === "string")
    : typeof existing.tokenHash === "string"
      ? [existing.tokenHash]
      : [];
  return [...earlier.filter((item) => item !== tokenHash), tokenHash].slice(-20);
}

/** Whether a stored invitation answers to this link: its newest, or one sent earlier. */
export function invitationAnswersTo(
  invitation: { tokenHash?: unknown; tokenHashes?: unknown },
  tokenHash: string,
  equal: (left: string, right: string) => boolean,
): boolean {
  if (typeof invitation.tokenHash === "string" && equal(invitation.tokenHash, tokenHash)) return true;
  return Array.isArray(invitation.tokenHashes)
    ? invitation.tokenHashes.some((item) => typeof item === "string" && equal(item, tokenHash))
    : false;
}

/** Seconds within which a second send to the same address is the same tap. */
export const INVITE_REPEAT_WINDOW_MS = 30_000;

export function inviteJustSent(
  lastSentAt: unknown,
  sentTo: unknown,
  email: string,
  nowMs: number,
): boolean {
  if (typeof lastSentAt !== "string" || normalizeInviteEmail(String(sentTo ?? "")) !== normalizeInviteEmail(email))
    return false;
  const at = Date.parse(lastSentAt);
  return Number.isFinite(at) && nowMs - at >= 0 && nowMs - at < INVITE_REPEAT_WINDOW_MS;
}
