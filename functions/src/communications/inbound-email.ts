/**
 * Inbound email parsing — mirror.
 *
 * `features/messaging/inbound-email.ts` is the source of truth and carries the
 * unit tests (`npm test`); functions/ is a separate package and cannot import
 * from features/, the same situation as agreed-retainer.ts. Change the features/
 * copy first, then bring this in line.
 */

/**
 * Where the quoted history begins. Ordered by how unambiguous each marker is —
 * the earliest match in the body wins, so a reply containing several of them
 * still cuts at the first.
 */
const quoteMarkers: RegExp[] = [
  // Gmail and Apple Mail. The attribution frequently wraps mid-line, so
  // newlines are allowed inside it.
  /^On[\s\S]{1,300}?\bwrote:\s*$/m,
  // Outlook, several locales' worth of the same divider.
  /^\s*-{2,}\s*Original Message\s*-{2,}/im,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/im,
  // Outlook's horizontal rule above quoted mail.
  /^_{5,}\s*$/m,
  // Outlook header block: only a marker when a From: line is followed closely
  // by Sent:/Date:, otherwise "From:" is just something someone typed.
  /^From:.+(?:\r?\n.*){0,3}\r?\n\s*(?:Sent|Date):.+$/im,
  // A run of quoted lines.
  /^>.*$/m,
];

/** Signature blocks, cut only from the end of what remains. */
const signatureMarkers: RegExp[] = [
  /^--\s*$/m,
  /^Sent from my \w[\w\s]{0,30}$/im,
  /^Get Outlook for \w+$/im,
];

/**
 * Cut the body down to what this person wrote.
 *
 * Falls back to the original whenever trimming would leave nothing: a short
 * reply like "Yes — 4pm works" can look like a quote fragment, and an empty
 * message in the thread is worse than a slightly noisy one.
 */
export function stripQuotedReply(value: string): string {
  const normalized = value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
  if (!normalized) return "";

  let cut = normalized.length;
  for (const marker of quoteMarkers) {
    const match = marker.exec(normalized);
    if (match && match.index < cut) cut = match.index;
  }
  let body = normalized.slice(0, cut).trim();

  for (const marker of signatureMarkers) {
    const match = marker.exec(body);
    if (match) body = body.slice(0, match.index).trim();
  }

  // Collapse the runs of blank lines that quoting tends to leave behind.
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  return body || normalized;
}

/**
 * Mail that must not become a message in a thread.
 *
 * Out-of-office replies are the common case and the most damaging: without this
 * an autoresponder answering a lifecycle email would raise an unread count, put
 * "I am away until Monday" in the thread as if the client had written it, and —
 * once Phase 4 lands — have the AI draft a reply to a robot.
 *
 * Header names arrive in mixed case from different providers, so lookups are
 * case-insensitive.
 */
export function isAutomatedEmail(headers: Record<string, string>): boolean {
  const read = (name: string): string => {
    const entry = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === name,
    );
    return (entry?.[1] ?? "").trim().toLowerCase();
  };

  // RFC 3834. Anything other than "no" means the mail was generated, not typed.
  const autoSubmitted = read("auto-submitted");
  if (autoSubmitted && autoSubmitted !== "no") return true;

  if (read("x-autoreply")) return true;
  if (read("x-autorespond")) return true;
  if (read("x-auto-response-suppress")) return true;

  const precedence = read("precedence");
  if (["bulk", "auto_reply", "junk", "list"].includes(precedence)) return true;

  // An empty return path is how bounces identify themselves.
  const returnPath = read("return-path");
  if (returnPath === "<>") return true;

  if (read("x-failed-recipients")) return true;

  const contentType = read("content-type");
  if (contentType.includes("report-type=delivery-status")) return true;

  return false;
}

/**
 * Pull the thread token out of the address the mail was delivered to.
 *
 * SendGrid hands over every recipient, so the studio's own address and any
 * carbon copies are in there too — only the `reply+` local part identifies a
 * thread. Matching is anchored on that prefix rather than the domain so the
 * inbound subdomain can change without touching this.
 */
export function replyTokenFromRecipients(value: string): string | null {
  const match = value.match(/reply\+([A-Za-z0-9_.-]{16,400})@/i);
  return match?.[1] ?? null;
}

/** Subject lines accumulate a reply prefix per exchange; keep the last one. */
export function normalizeSubject(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.replace(/^(?:\s*(?:re|fwd?|aw|sv|vs)\s*:\s*)+/i, "").trim() || trimmed;
}
