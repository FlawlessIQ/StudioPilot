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

/**
 * A line the writer meant as a list item: "- ", "* ", "• ", "1. ", "2) ".
 */
export const bulletLinePattern = /^\s*(?:[-–—*•]|\d+[.)])\s+/;

/**
 * Split a written message into paragraphs, keeping lists as lists.
 *
 * The line-collapsing below is what makes prose survive a hard-wrapped
 * source, but it flattened a list into one run-on sentence: a set of
 * questions sent to a couple arrived as "- What is the ceremony start time?
 * - What is the reception start time? - Do you have a timeline..." in a
 * single paragraph. A run of bullet lines is now kept as its own block with
 * its newlines intact, so the renderer can lay it out as a list and the
 * plain-text alternative still reads as one item per line.
 */
export function clientEmailParagraphs(value: string): string[] {
  const cleaned = normalizeClientEmailBody(value);
  const blocks: string[] = [];
  for (const chunk of cleaned.split(/\n\s*\n+/)) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    // A chunk can hold a lead-in and then its list — "A few questions:" above
    // the questions themselves — so group consecutive bullets rather than
    // requiring the whole chunk to be one or the other.
    let run: string[] = [];
    let runIsList = false;
    const flush = () => {
      if (!run.length) return;
      blocks.push(runIsList ? run.join("\n") : run.join(" "));
      run = [];
    };
    for (const line of lines) {
      const isBullet = bulletLinePattern.test(line);
      if (run.length && isBullet !== runIsList) flush();
      runIsList = isBullet;
      run.push(line);
    }
    flush();
  }
  return blocks.length ? blocks : [cleaned];
}
