/**
 * A makeup or hair client's party list, read from their form
 * (docs/vendor-journeys-plan.md, 3.3).
 *
 * The recommended Party list (recommended-templates.ts, "beauty-party-list")
 * asks for one person per line — "Maya Brooks — bride — hair and makeup —
 * sensitive skin" — because a form has no rows to add. This reads those lines
 * into people, each with a role (the bride, a bridesmaid, a mother, a child)
 * and the services they want, so the chair schedule and the headcount on the
 * quote come from what the client wrote. Forgiving on purpose: dashes,
 * commas or tabs between the parts, any order after the name. Pure.
 */

export type PartyRole = "bride" | "party" | "mother" | "child";
export type BeautyService = "makeup" | "hair";

export type PartyMember = {
  name: string;
  role: PartyRole;
  services: BeautyService[];
  notes: string | null;
};

// "Mother of the bride", "bride's sister": the bride named as whose someone is
// is not the bride, so the bride is the word on its own (readRole strips the rest).
const ROLE_WORDS: ReadonlyArray<[RegExp, PartyRole]> = [
  [/\bbride\b(?!['’]s)|\bto be wed\b/i, "bride"],
  [/\bmother\b|\bmom\b|\bmum\b|\bmob\b|\bmog\b|\bgrandmother\b|\bgrandma\b/i, "mother"],
  [/flower ?girl|junior|\bjr\.? bridesmaid\b|\bchild\b|\bkid\b|\bdaughter\b|\bniece\b/i, "child"],
  [/bridesmaid|maid of honou?r|\bmoh\b|matron|\bparty\b|\bfriend\b|\bsister\b|\bguest\b/i, "party"],
];

function readRole(text: string): PartyRole | null {
  const plain = text.replace(/\b(?:of|to) the (?:bride|groom)\b/gi, "");
  return ROLE_WORDS.find(([pattern]) => pattern.test(plain))?.[1] ?? null;
}

/** The services a line asks for; none named means the studio's own. */
function servicesIn(text: string, own: BeautyService): BeautyService[] {
  const both = /\bboth\b|hair\s*(?:and|&|\+|\/)\s*make.?up|make.?up\s*(?:and|&|\+|\/)\s*hair|\bhmu\b/i.test(text);
  if (both) return ["hair", "makeup"];
  const hair = /\bhair\b|updo|blow.?out|style/i.test(text);
  const makeup = /make.?up|\bmua\b|lashes|airbrush/i.test(text);
  if (hair && makeup) return ["hair", "makeup"];
  if (hair) return ["hair"];
  if (makeup) return ["makeup"];
  return [own];
}

/**
 * The people on the list. `own` is the studio's trade's service: a line that
 * names none is that. Empty lines and headings ("Bridesmaids:") are skipped.
 */
export function parsePartyList(text: unknown, own: BeautyService): PartyMember[] {
  if (typeof text !== "string") return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line && !/^[^—–\-,:]+:\s*$/.test(line))
    .slice(0, 40)
    .map((line) => {
      const parts = line.split(/\s+[—–-]\s+|\t|\s*,\s*/).map((part) => part.trim()).filter(Boolean);
      const name = parts[0] ?? line;
      const rest = parts.slice(1).join(" — ");
      const role = readRole(rest) ?? readRole(name) ?? "party";
      // Notes: whatever after the name says neither the role nor the service.
      const notes = parts
        .slice(1)
        .filter((part) => readRole(part) === null && !/\b(?:of|to) the (?:bride|groom)\b/i.test(part))
        .filter((part) => !/^(?:hair|make.?up|both|hair\s*(?:and|&|\+|\/)\s*make.?up|make.?up\s*(?:and|&|\+|\/)\s*hair|hmu)$/i.test(part))
        .join(" — ");
      return { name, role, services: servicesIn(rest, own), notes: notes || null };
    });
}

/** How many of each, for the quote: "1 bride, 5 in the party, 2 mothers, 1 child". */
export function partyHeadcount(people: readonly PartyMember[], service?: BeautyService): Record<PartyRole, number> {
  const counts: Record<PartyRole, number> = { bride: 0, party: 0, mother: 0, child: 0 };
  for (const person of people) {
    if (service && !person.services.includes(service)) continue;
    counts[person.role] += 1;
  }
  return counts;
}
