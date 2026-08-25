import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-thread reply addresses.
 *
 * Until now `reply_to` on every studio email resolved to the studio's own
 * address, so a client's reply went to their ordinary inbox and StudioCue never
 * saw it. That is the single thing that made "move my email into StudioCue"
 * impossible.
 *
 * The token is self-describing and signed rather than random-and-stored: it
 * carries the conversation id, so inbound mail resolves to a thread without a
 * lookup or an index, and the signature is what stops anyone writing into an
 * arbitrary thread by editing an address. The same approach as the COI and
 * gallery reply tokens, minus their stored hash.
 *
 * Fails closed. With no signing secret configured, no reply address is produced
 * and the caller keeps the existing behaviour — which is what made this safe to
 * deploy before the secret existed.
 */

const SIGNATURE_LENGTH = 16;

function secret(): string | null {
  const value = process.env.INBOUND_REPLY_SIGNING_SECRET;
  return value && value.length >= 32 ? value : null;
}

/**
 * Reuses SENDGRID_INBOUND_DOMAIN rather than introducing a second variable for
 * the same value. That one is already set on every function that sends mail and
 * is the domain the COI and gallery reply tokens already arrive on, so a
 * mismatch between two names could only ever be a bug.
 */
function inboundDomain(): string | null {
  const value = process.env.SENDGRID_INBOUND_DOMAIN?.trim().replace(/^@/, "");
  return value || null;
}

function sign(conversationId: string, key: string): string {
  return createHmac("sha256", key)
    .update(conversationId)
    .digest("hex")
    .slice(0, SIGNATURE_LENGTH);
}

/**
 * `reply+<base64url(conversationId)>.<signature>@<inbound domain>`, or null when
 * inbound mail is not configured.
 */
export function replyAddressFor(conversationId: string): string | null {
  const key = secret();
  const domain = inboundDomain();
  if (!key || !domain || !conversationId) return null;
  const encoded = Buffer.from(conversationId, "utf8").toString("base64url");
  return `reply+${encoded}.${sign(conversationId, key)}@${domain}`;
}

/**
 * Recover the conversation id from an inbound token, or null if the signature
 * does not hold. Compared in constant time: the check is the only thing standing
 * between a guessed address and someone else's thread.
 */
export function conversationIdFromReplyToken(token: string): string | null {
  const key = secret();
  if (!key) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (signature.length !== SIGNATURE_LENGTH) return null;

  let conversationId: string;
  try {
    conversationId = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!conversationId || !/^conv_[0-9a-f]{16}$/.test(conversationId)) return null;

  const expected = Buffer.from(sign(conversationId, key));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return null;
  return timingSafeEqual(expected, provided) ? conversationId : null;
}

/** True when inbound replies are configured end to end. */
export function inboundRepliesEnabled(): boolean {
  return Boolean(secret() && inboundDomain());
}
