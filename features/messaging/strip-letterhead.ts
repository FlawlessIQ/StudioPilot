/**
 * Removing sending chrome from a stored message body.
 *
 * Emails are rendered with a letterhead and footer before sending. The send path
 * now stores a chrome-free `threadBody` alongside the sent text, but messages
 * written before that change kept the whole rendered email — so the studio's own
 * thread opens with "FlawlessIQ · Powered by StudioCue" above the actual words.
 *
 * Conservative by design. It removes only shapes it recognises at the very start
 * or end of the body, and returns the input unchanged when it is unsure: a
 * message body is the record of what was said to a client, and trimming a real
 * sentence out of one is worse than leaving a line of letterhead in.
 *
 * Pure, no I/O.
 */

/** Lines that are sending chrome rather than anything a person wrote. */
const LEADING_CHROME = [
  /^.{0,60}·\s*Powered by StudioCue\s*$/i,
  /^Powered by StudioCue\s*$/i,
];

const TRAILING_CHROME = [
  /^Sent (?:securely )?(?:via|by) StudioCue\.?\s*$/i,
  /^Powered by StudioCue\.?\s*$/i,
  /^You are receiving this because.*$/i,
  /^This message was sent by .* via StudioCue\.?\s*$/i,
];

/** Whether a stored body still carries sending chrome. */
export function hasLetterhead(body: unknown): boolean {
  if (typeof body !== "string" || !body.trim()) return false;
  return stripLetterhead(body) !== body;
}

/**
 * The body without its letterhead or footer.
 *
 * Only strips whole lines, only at the ends, and only shapes it recognises.
 */
export function stripLetterhead(body: unknown): string {
  if (typeof body !== "string") return "";
  const original = body;
  let lines = original.split("\n");

  const isBlank = (line: string) => line.trim() === "";

  // Leading chrome, plus any blank lines it leaves behind.
  while (lines.length) {
    const first = lines.findIndex((line) => !isBlank(line));
    if (first === -1) break;
    const candidate = lines[first]!.trim();
    if (!LEADING_CHROME.some((pattern) => pattern.test(candidate))) break;
    lines = lines.slice(first + 1);
  }

  // Trailing chrome, same treatment from the other end.
  while (lines.length) {
    let last = -1;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!isBlank(lines[index]!)) {
        last = index;
        break;
      }
    }
    if (last === -1) break;
    const candidate = lines[last]!.trim();
    if (!TRAILING_CHROME.some((pattern) => pattern.test(candidate))) break;
    lines = lines.slice(0, last);
  }

  const cleaned = lines.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
  // Never hand back an empty body: if stripping consumed everything, the body
  // was not what this function assumed and the original is the safer answer.
  return cleaned.trim() ? cleaned : original;
}
