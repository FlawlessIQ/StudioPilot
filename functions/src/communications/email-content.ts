const greetingPattern =
  /^\s*(?:(?:hi|hello|dear)\s+[^,\n!]{1,80}[,!]|(?:hi|hello)[,!])\s*/i;

const signoffPattern =
  /(?:\n+|\s+(?=(?:best(?: regards)?|warm(?: regards)?|regards|sincerely|thanks|thank you|cheers)[,:]))(?:best(?: regards)?|warm(?: regards)?|regards|sincerely|thanks|thank you|cheers)[,!:.]?\s*(?:\n|\s{2,})?[a-z0-9&.'’ -]{0,80}\s*$/i;

/**
 * StudioCue owns the greeting and studio footer in the branded renderer. This
 * keeps AI- or user-written content from producing duplicate greetings and
 * signatures while preserving the actual message.
 */
export function normalizeClientEmailBody(value: string): string {
  const normalized = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();
  const withoutGreeting = normalized.replace(greetingPattern, "").trim();
  const withoutSignoff = withoutGreeting.replace(signoffPattern, "").trim();
  return withoutSignoff || normalized;
}

export function clientEmailParagraphs(value: string): string[] {
  const cleaned = normalizeClientEmailBody(value);
  const paragraphs = cleaned
    .split(/\n\s*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
  return paragraphs.length ? paragraphs : [cleaned];
}
