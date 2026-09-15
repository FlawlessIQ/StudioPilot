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

export type ForwardedInquiry = {
  /** The person who originally wrote, when the forward shows it. */
  senderName: string | null;
  senderEmail: string | null;
  /** The original message, without the forwarding wrapper. */
  message: string;
  /** YYYY-MM-DD when the message names a single plausible event date. */
  eventDate: string | null;
  /** Where it seems to have come from, for the lead's source. */
  source: "the_knot" | "weddingwire" | "zola" | "instagram" | "email";
};

const FORWARD_MARKERS = [
  /-{2,}\s*Forwarded message\s*-{2,}/i,
  /^Begin forwarded message:/im,
  /-{2,}\s*Original Message\s*-{2,}/i,
];

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

function sourceOf(text: string): ForwardedInquiry["source"] {
  const lower = text.toLowerCase();
  if (lower.includes("theknot.com") || lower.includes("the knot")) return "the_knot";
  if (lower.includes("weddingwire")) return "weddingwire";
  if (lower.includes("zola.com")) return "zola";
  if (lower.includes("instagram")) return "instagram";
  return "email";
}

/**
 * Read a forwarded email back into an inquiry.
 *
 * `forwarderEmail` is the studio (whoever forwarded it); an original sender
 * equal to it is not the couple.
 */
export function parseForwardedInquiry(input: {
  text: string;
  forwarderEmail: string;
  today: string;
}): ForwardedInquiry {
  const text = input.text.replaceAll("\r\n", "\n");
  let body = text;
  let senderName: string | null = null;
  let senderEmail: string | null = null;

  const marker = FORWARD_MARKERS.map((pattern) => pattern.exec(text)).find(Boolean);
  if (marker) {
    const after = text.slice(marker.index + marker[0].length).replace(/^\s+/, "");
    const lines = after.split("\n");
    let index = 0;
    for (; index < Math.min(lines.length, 12); index += 1) {
      const line = lines[index]!.trim();
      if (!line) {
        // The header block ends at the first blank line after at least one header.
        if (senderEmail || senderName) {
          index += 1;
          break;
        }
        continue;
      }
      const from = /^From:\s*(.*)$/i.exec(line);
      if (from) {
        const value = from[1]!.trim();
        const angle = /^(.*?)\s*<([^>]+@[^>]+)>$/.exec(value);
        if (angle) {
          senderName = angle[1]!.replace(/^"|"$/g, "").trim() || null;
          senderEmail = angle[2]!.trim().toLowerCase();
        } else if (/^[^\s@]+@[^\s@]+$/.test(value)) {
          senderEmail = value.toLowerCase();
        } else {
          senderName = value || null;
        }
        continue;
      }
      if (!/^(Date|Sent|Subject|To|Cc|Reply-To):/i.test(line)) break;
    }
    body = lines.slice(index).join("\n");
  }

  // The studio forwarding its own note, or a marketplace's no-reply sender,
  // is not the couple; their address is then in the body.
  if (
    senderEmail &&
    (senderEmail === input.forwarderEmail.trim().toLowerCase() ||
      /(?:^|[._+-])no-?reply|notifications?@|@(?:[a-z0-9-]+\.)*(?:theknot|weddingwire|zola|instagram|facebookmail)\.com$/i.test(senderEmail))
  ) {
    senderEmail = null;
    senderName = null;
  }
  // Marketplace notifications put the couple's address on a Reply-To or in the
  // body ("Email: …"); take a labelled address when no sender was found.
  if (!senderEmail) {
    const labelled = /\b(?:e-?mail|reply to)\s*:\s*([^\s<>]+@[^\s<>]+\.[a-z]{2,})/i.exec(body);
    if (labelled) senderEmail = labelled[1]!.toLowerCase();
  }
  if (!senderName) {
    const labelled = /\b(?:name|from)\s*:\s*([A-Za-z][A-Za-z' .&-]{1,60})$/im.exec(body);
    if (labelled) senderName = labelled[1]!.trim();
  }

  const message = body.trim().slice(0, 5000);
  return {
    senderName,
    senderEmail,
    message,
    eventDate: eventDateFrom(message, input.today),
    source: sourceOf(text),
  };
}
