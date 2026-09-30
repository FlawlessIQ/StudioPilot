/**
 * What the studio is told before it takes someone off a job, and after.
 *
 * Shared by the job page's crew card and Cue's withdraw/replace cards, so the
 * sentence a studio confirms is the same everywhere. It names the person and
 * says plainly whether they will be emailed — the difference between an offer
 * quietly disappearing from somebody's crew app and telling a booked second
 * shooter their date is gone. The rule behind it is features/crew/withdraw.ts.
 */
export function withdrawConsequence(input: {
  name: string;
  role: string;
  accepted: boolean;
  replace: boolean;
}): string {
  const who = `${input.name} (${input.role})`;
  const told = input.accepted
    ? `${input.name} is emailed that they've been released, and the day comes out of their calendar.`
    : `${input.name} hasn't accepted, so they aren't emailed — the offer disappears from their crew app.`;
  return input.replace
    ? `Withdraw ${who} and offer the role to the next person on your list. ${told}`
    : `Withdraw ${who} from this job. ${told} The role goes back to open.`;
}

export type WithdrawOutcome = {
  replaced: boolean;
  replacementName: string | null;
  notified: boolean;
};

/** Read the command's answer without trusting its shape. */
export function withdrawOutcome(result: Record<string, unknown>): WithdrawOutcome {
  const replacement =
    typeof result.replacement === "object" && result.replacement !== null
      ? (result.replacement as Record<string, unknown>)
      : null;
  return {
    replaced: replacement !== null,
    replacementName:
      typeof replacement?.name === "string" && replacement.name
        ? replacement.name
        : null,
    notified: result.notified === true,
  };
}

/**
 * The sentence after it is done — including a Replace that found nobody left
 * on the list, which must say so rather than read as though cover is coming.
 */
export function withdrawDoneMessage(
  outcome: WithdrawOutcome,
  input: { name: string; role: string; replace: boolean },
): string {
  const told = outcome.notified ? " They've been emailed." : "";
  if (!input.replace) return `${input.name} is off this job.${told}`;
  return outcome.replaced
    ? `${input.name} is off this job, and the ${input.role} role has been offered to ${outcome.replacementName ?? "the next person on your list"}.${told}`
    : `${input.name} is off this job.${told} Nobody else was on the list for ${input.role} — choose who to offer it to next.`;
}
