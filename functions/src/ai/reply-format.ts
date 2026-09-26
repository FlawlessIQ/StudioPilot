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
