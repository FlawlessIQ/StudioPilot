import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Reply addresses for team mail about a piece of feedback (docs/console.md,
 * "Inbox").
 *
 * When the team replies to feedback from the Console, Reply-To is
 * `feedback+<id>.<signature>@<inbound domain>`, so the studio's answer comes
 * back to that feedback's thread instead of only to a mailbox. Same scheme as
 * the client-thread reply addresses (communications/reply-address.ts): the id
 * rides in the address and the HMAC is what stops anyone writing into someone
 * else's feedback by editing it.
 *
 * Fails closed: with no signing secret or inbound domain, no address is made
 * and the team inbox stays the Reply-To.
 */
const FEEDBACK_ID = /^fb_([0-9a-f]{28})$/;
const SIGNATURE_BYTES = 8;

function secret(): string | null {
  const value = process.env.INBOUND_REPLY_SIGNING_SECRET;
  return value && value.length >= 32 ? value : null;
}

function inboundDomain(): string | null {
  const value = process.env.SENDGRID_INBOUND_DOMAIN?.trim().replace(/^@/, "");
  return value || null;
}

function sign(feedbackId: string, key: string): string {
  return createHmac("sha256", key).update(`feedback:${feedbackId}`).digest().subarray(0, SIGNATURE_BYTES).toString("base64url");
}

export function feedbackReplyAddress(feedbackId: string): string | null {
  const key = secret();
  const domain = inboundDomain();
  const hex = FEEDBACK_ID.exec(feedbackId)?.[1];
  if (!key || !domain || !hex) return null;
  return `feedback+${Buffer.from(hex, "hex").toString("base64url")}.${sign(feedbackId, key)}@${domain}`;
}

/** `feedback+<token>@…` anywhere in the recipients, or null. */
export function feedbackTokenFromRecipients(value: string): string | null {
  return value.match(/feedback\+([A-Za-z0-9_-]{19}\.[A-Za-z0-9_-]{11})@/i)?.[1] ?? null;
}

export function feedbackIdFromReplyToken(token: string): string | null {
  const key = secret();
  if (!key) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length !== 14) return null;
  const feedbackId = `fb_${bytes.toString("hex")}`;
  const expected = Buffer.from(sign(feedbackId, key));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided) ? feedbackId : null;
}
