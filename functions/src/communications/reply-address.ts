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

/**
 * A conversation id is `conv_` plus 16 hex characters — 8 bytes of entropy
 * carried as 21 characters of text. Encoding those 8 bytes directly, rather than
 * base64-ing the whole string, is what keeps the address short: 11 characters
 * instead of 28.
 */
const ID_BYTES = 8;
/** 8 bytes of HMAC, base64url, so 64 bits of signature in 11 characters. */
const SIGNATURE_BYTES = 8;
const COMPACT_SIGNATURE_LENGTH = 11;

/**
 * The first format shipped base64url of the whole id string with a 16-character
 * hex signature, giving a 45-character token. Addresses in mail already sent
 * carry it, so verification still accepts it — a client replying to last week's
 * email must not hit a dead address. Nothing mints it any more.
 */
const LEGACY_SIGNATURE_LENGTH = 16;

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

function signCompact(conversationId: string, key: string): string {
  return createHmac("sha256", key)
    .update(conversationId)
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString("base64url");
}

function signLegacy(conversationId: string, key: string): string {
  return createHmac("sha256", key)
    .update(conversationId)
    .digest("hex")
    .slice(0, LEGACY_SIGNATURE_LENGTH);
}

/** Constant time, because this check is all that separates a guessed address
 *  from writing into someone else's thread. */
function signatureMatches(expected: string, provided: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(provided);
  return left.length === right.length && timingSafeEqual(left, right);
}

const CONVERSATION_ID = /^conv_([0-9a-f]{16})$/;

/**
 * `reply+<base64url(conversationId)>.<signature>@<inbound domain>`, or null when
 * inbound mail is not configured.
 */
export function replyAddressFor(conversationId: string): string | null {
  const key = secret();
  const domain = inboundDomain();
  if (!key || !domain) return null;
  const hex = CONVERSATION_ID.exec(conversationId)?.[1];
  if (!hex) return null;
  const encoded = Buffer.from(hex, "hex").toString("base64url");
  return `reply+${encoded}.${signCompact(conversationId, key)}@${domain}`;
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

  let conversationId: string | null = null;
  let expected: string | null = null;

  if (signature.length === COMPACT_SIGNATURE_LENGTH) {
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length !== ID_BYTES) return null;
    conversationId = `conv_${bytes.toString("hex")}`;
    expected = signCompact(conversationId, key);
  } else if (signature.length === LEGACY_SIGNATURE_LENGTH) {
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    if (!CONVERSATION_ID.test(decoded)) return null;
    conversationId = decoded;
    expected = signLegacy(conversationId, key);
  } else {
    return null;
  }

  return signatureMatches(expected, signature) ? conversationId : null;
}

/** True when inbound replies are configured end to end. */
export function inboundRepliesEnabled(): boolean {
  return Boolean(secret() && inboundDomain());
}
