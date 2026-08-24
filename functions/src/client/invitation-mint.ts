import { createHash, randomBytes } from "node:crypto";

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
