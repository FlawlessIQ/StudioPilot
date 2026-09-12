import { createHash, randomBytes } from "node:crypto";

/**
 * Minting a run-of-show vendor share, in one place.
 *
 * Mirrors `client/invitation-mint.ts`: the id is derived from tenant, project
 * and vendor so re-sharing a newer version reuses the *same* document (and the
 * same live link) rather than forking a second one. The token is the secret —
 * it goes in the URL and is never stored; only its hash is. `functions/` cannot
 * import `features/`, so the hashing here must stay byte-for-byte identical to
 * the public route handlers that resolve the token (`createHash("sha256")`).
 */
export type MintedShare = {
  shareId: string;
  /** The secret. Goes in the share link and is never stored. */
  token: string;
  /** What the share document stores instead of the token. */
  tokenHash: string;
  shareUrl: string;
  expiresAt: string;
};

export const hashShareToken = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const shareIdFor = (
  tenantId: string,
  projectId: string,
  vendorContactId: string,
) =>
  `ros_share_${hashShareToken(`${tenantId}:${projectId}:${vendorContactId}`).slice(0, 32)}`;

export function mintRunOfShowShare(input: {
  tenantId: string;
  projectId: string;
  vendorContactId: string;
  appUrl: string;
}): MintedShare {
  const token = randomBytes(32).toString("base64url");
  return {
    shareId: shareIdFor(input.tenantId, input.projectId, input.vendorContactId),
    token,
    tokenHash: hashShareToken(token),
    shareUrl: `${input.appUrl.replace(/\/$/, "")}/share/${token}`,
    // Weddings are planned months out; a vendor share should outlive that, so
    // 120 days rather than the 7 a client invitation gets.
    expiresAt: new Date(Date.now() + 120 * 86400000).toISOString(),
  };
}
