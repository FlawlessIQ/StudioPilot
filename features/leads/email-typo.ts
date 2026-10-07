/**
 * "Did you mean …@gmail.com?" for a mistyped email domain.
 *
 * Albert typed gamil.com on GR's inquiry form (2026-10-07), and every email
 * to him dropped — "This happens all the time where they mistype their
 * emails" (Gabe). Only the common personal domains are checked, and only a
 * near miss is offered: it is a suggestion the couple can take or ignore,
 * never a block, because a studio's couples use every domain there is.
 */
const COMMON = [
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "msn.com",
  "me.com",
  "mac.com",
  "ymail.com",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "protonmail.com",
  // Real providers a step away from the ones above: never "corrected".
  "mail.com",
  "gmx.com",
  "aim.com",
  "zoho.com",
  "hey.com",
  "fastmail.com",
  "proton.me",
] as const;

/** Edits between two strings, a swap of neighbors counting as one. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1);
    }
  }
  return rows[a.length]![b.length]!;
}

/** The address with its domain corrected, or null when it looks right. */
export function suggestEmailFix(email: string): string | null {
  const value = email.trim();
  const at = value.lastIndexOf("@");
  if (at < 1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1).toLowerCase();
  if (!domain.includes(".") || (COMMON as readonly string[]).includes(domain)) return null;
  let best: { domain: string; edits: number } | null = null;
  for (const candidate of COMMON) {
    const edits = distance(domain, candidate);
    if (!best || edits < best.edits) best = { domain: candidate, edits };
  }
  // Two edits on a long domain (gmial.con), one on a short one (me.cm): any
  // more and a real domain starts to look like a typo of a popular one.
  const allowed = best && best.domain.length >= 8 ? 2 : 1;
  return best && best.edits <= allowed ? `${local}@${best.domain}` : null;
}
