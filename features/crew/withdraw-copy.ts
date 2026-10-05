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

/**
 * Somebody still waiting on a job the studio wants to delete or archive.
 *
 * GR Productions, 2026-10-01: "I tried to delete [the] job to restart and
 * won't let me … They say I have an offer out." The refusal named nobody. This
 * is what the delete and archive panels list instead, so the studio sees who
 * it is before choosing to withdraw them.
 */
export type WaitingCrewMember = {
  assignmentId: string;
  name: string | null;
  role: string;
  status: string;
};

/** Where things stand with them, in the studio's words. */
export function waitingStatusLabel(status: string): string {
  if (status === "accepted") return "accepted";
  if (status === "draft") return "drafted, not sent";
  return "offer not answered";
}

/** "Alex Rivera (Second shooter) — offer not answered". */
export function waitingLine(
  member: Pick<WaitingCrewMember, "name" | "role" | "status">,
): string {
  const who = member.name ? `${member.name} (${member.role})` : member.role;
  return `${who} — ${waitingStatusLabel(member.status)}`;
}

/**
 * What "Withdraw these and …" does to each of them, said before they press it.
 *
 * The same rule as withdrawing one person (withdrawConsequence above): only
 * somebody who accepted is emailed, because only they are holding the date.
 */
export function withdrawAllConsequence(
  waiting: readonly Pick<WaitingCrewMember, "name" | "role" | "status">[],
): string {
  const named = (member: Pick<WaitingCrewMember, "name" | "role">) =>
    member.name ?? `your ${member.role.toLocaleLowerCase()}`;
  const join = (names: string[]) =>
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const accepted = waiting.filter((member) => member.status === "accepted");
  const unanswered = waiting.filter((member) => member.status !== "accepted");
  const parts: string[] = [];
  if (accepted.length)
    parts.push(
      `${join(accepted.map(named))} already said yes, so ${accepted.length === 1 ? "they're" : "each of them is"} emailed that they've been released, with a calendar file that takes the day off their calendar.`,
    );
  if (unanswered.length)
    parts.push(
      `${join(unanswered.map(named))} ${unanswered.length === 1 ? "hasn't" : "haven't"} said yes, so they aren't emailed — the offer just closes.`,
    );
  return parts.join(" ");
}
