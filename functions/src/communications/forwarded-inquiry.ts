import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Inquiries from anywhere: a studio forwards an email and it becomes a lead.
 *
 * Inquiries do not all arrive through the website form. They come to the
 * photographer's own inbox, from The Knot and WeddingWire notification emails,
 * and as replies to old threads — and the only way into StudioCue was to paste
 * each one into New job by hand. Each studio now has a private forwarding
 * address, `inquiries+<slug>.<signature>@<inbound domain>`; anything forwarded
 * there is read back into a lead: who originally wrote, what they said, and the
 * event date when the message names one.
 *
 * Pure apart from the signing key. Nothing here writes.
 */

const SIGNATURE_BYTES = 8;
const SIGNATURE_LENGTH = 11;

function key(): string | null {
  const value = process.env.INBOUND_REPLY_SIGNING_SECRET;
  return value && value.length >= 32 ? value : null;
}

function domain(): string | null {
  const value = process.env.SENDGRID_INBOUND_DOMAIN?.trim().replace(/^@/, "");
  return value || null;
}

function sign(tenantId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`inquiries:${tenantId}`)
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString("base64url");
}

/** The studio's private forwarding address, or null when inbound mail is off. */
export function inquiryAddressFor(tenantId: string, slug: string): string | null {
  const secret = key();
  const inbound = domain();
  if (!secret || !inbound || !/^[a-z0-9-]{2,80}$/.test(slug)) return null;
  return `inquiries+${slug}.${sign(tenantId, secret)}@${inbound}`;
}

/** A header by name, whatever case the sending server wrote it in. */
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

function envelopeOf(fields: { envelope?: string }): { to: string[]; from: string | null } {
  try {
    const parsed = JSON.parse(fields.envelope ?? "") as { to?: unknown; from?: unknown };
    return {
      to: Array.isArray(parsed.to) ? parsed.to.map(String) : [],
      from: typeof parsed.from === "string" && parsed.from.includes("@") ? parsed.from.trim().toLowerCase() : null,
    };
  } catch {
    return { to: [], from: null };
  }
}

/**
 * Every address this message was delivered to, envelope first.
 *
 * The envelope is where the message was actually sent; the `To:` header is
 * only what the original author wrote. They differ exactly when it matters: a
 * Gmail filter that auto-forwards a website's form notification keeps the
 * original headers, so `To:` still names the studio's own mailbox and only the
 * envelope carries the inquiry address. Reading `to` first quarantined every
 * such forward — the studio's main way in — while a hand forward, which
 * rewrites `To:`, worked and hid it.
 */
export function inboundRecipients(
  fields: { envelope?: string; to?: string; cc?: string },
  headers: Record<string, string>,
): string {
  return [
    ...envelopeOf(fields).to,
    fields.to,
    fields.cc,
    headerValue(headers, "To"),
    headerValue(headers, "Cc"),
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(",");
}

/**
 * Who handed this message to our mail server, lower-cased, or null.
 *
 * Distinct from `From:`. A Gmail filter forward keeps the form builder in
 * `From:` and rewrites the envelope sender to the forwarding mailbox
 * (`studio+caf_=…@gmail.com`), which is what says the studio sent it on.
 */
export function envelopeSender(fields: { envelope?: string }): string | null {
  return envelopeOf(fields).from;
}

/** `<slug>.<signature>` from a recipient list, or null. */
export function inquiryTokenFromRecipients(recipients: string): { slug: string; signature: string } | null {
  const match = recipients.match(/inquiries\+([a-z0-9-]{2,80})\.([A-Za-z0-9_-]{11})@/i);
  return match ? { slug: match[1]!.toLowerCase(), signature: match[2]! } : null;
}

/** Constant-time check that a signature was minted for this tenant. */
export function inquirySignatureMatches(tenantId: string, signature: string): boolean {
  const secret = key();
  if (!secret || signature.length !== SIGNATURE_LENGTH) return false;
  const expected = Buffer.from(sign(tenantId, secret));
  const provided = Buffer.from(signature);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}


const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * The event date, only when the message is unambiguous about it.
 *
 * A wrong date is worse than none: the availability check would clear or
 * refuse the wrong day. So a date is taken only when every date-like mention
 * in the message agrees, and dates before `today` (sent dates, "we met on")
 * are ignored.
 */
export function eventDateFrom(text: string, today: string): string | null {
  const found = new Set<string>();
  const named = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi;
  for (const match of text.matchAll(named)) {
    const value = iso(Number(match[3]), MONTHS[match[1]!.toLowerCase()] ?? 0, Number(match[2]));
    if (value) found.add(value);
  }
  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?),?\s+(20\d{2})\b/gi;
  for (const match of text.matchAll(dayFirst)) {
    const value = iso(Number(match[4]), MONTHS[match[3]!.toLowerCase()] ?? 0, Number(match[1]));
    if (value) found.add(value);
  }
  for (const match of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) {
    const value = iso(Number(match[3]), Number(match[1]), Number(match[2]));
    if (value) found.add(value);
  }
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const value = iso(Number(match[1]), Number(match[2]), Number(match[3]));
    if (value) found.add(value);
  }
  const future = [...found].filter((value) => value >= today);
  return future.length === 1 ? future[0]! : null;
}
