/**
 * A drafted email's greeting on its own line.
 *
 * The inquiry reply prompt gives the model `"Dear Maya,"` as its example, and
 * the model copies the greeting and runs straight on: a production draft began
 * "Dear Dana,Thank you for reaching out…". Approving a reply emails its body
 * verbatim, so that is what the couple would have read.
 *
 * Applied where drafts are created, not when they are sent: the studio reviews
 * and approves exactly the text that goes out.
 *
 * Only splits when the next word starts a new sentence — "Hi Emma, congratulations
 * on the engagement" is one sentence and stays one.
 */
// No `i` flag: the lookahead's capital letter is the whole test for "a new
// sentence starts here", so only the greeting words themselves ignore case.
const GREETING =
  /^(\s*(?:[Dd]ear|[Hh]i|[Hh]ello|[Hh]ey|[Gg]ood (?:[Mm]orning|[Aa]fternoon|[Ee]vening))\b[^,\n]{0,60},)[ \t]*(?=[A-Z])/;

export function separateGreeting(body: string): string {
  const match = GREETING.exec(body);
  if (!match) return body;
  return `${match[1]!.trimStart()}\n\n${body.slice(match[0].length)}`;
}

/**
 * A drafted reply that ends on a bare "Warmly," gets the studio's name under it.
 *
 * The inquiry reply prompt tells the model to end warmly but leave the name
 * off, because "the studio's name is added automatically" — and nothing added
 * it. A couple's first reply from the studio (production, 2026-09-29) ended on
 * "Warmly," and then the footer. Added here, at draft time, so the studio
 * approves the name that goes out and can change it.
 *
 * A sign-off that already carries a name is left alone.
 */
const BARE_SIGN_OFF =
  /\n[ \t]*((?:warmly|best|best wishes|thanks|thank you|kind regards|warm regards|regards|cheers|all the best|with love)[ \t]*,?)[ \t]*$/i;

export function signWithStudio(body: string, studioName: string): string {
  const name = studioName.trim();
  const trimmed = body.trimEnd();
  if (!name || !BARE_SIGN_OFF.test(trimmed)) return body;
  return `${trimmed}\n${name}`;
}
