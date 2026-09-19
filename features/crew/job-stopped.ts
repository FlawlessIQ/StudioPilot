/**
 * What happens to the crew when a job stops.
 *
 * Nothing did. `functions/src/crm/commands.ts` owns both `transitionProject`
 * and `archiveProject` and never touched `crewAssignments` at all, so calling
 * off a wedding left every offer standing: an un-answered offer still sitting
 * in somebody's inbox with a fee on it, and — worse — an *accepted* assignment
 * belonging to a second shooter who has blocked the date out and turned other
 * work down. They were told nothing, and the studio went on seeing the job
 * under "Upcoming work".
 *
 * Found archiving the test jobs from the 2026-09-19 production walk. Auto-offer
 * makes it much likelier to bite, because offers now leave at booking rather
 * than whenever someone gets round to staffing.
 *
 * Pure and deterministic. Duplicated at functions/src/crew/job-stopped.ts;
 * tests/crew-job-stopped.test.ts keeps the copies identical.
 */

/**
 * An assignment nobody has settled: the studio is either waiting on an answer
 * or expecting this person to work.
 *
 * `draft` is here because a drafted assignment is still the studio's intent to
 * hire; `expired`, `declined`, `reassigned`, `cancelled` and `completed` are
 * all over, one way or another.
 */
export const LIVE_ASSIGNMENT_STATUSES: readonly string[] = [
  "draft",
  "invited",
  "viewed",
  "accepted",
];

export function isLiveAssignment(status: unknown): boolean {
  return LIVE_ASSIGNMENT_STATUSES.includes(String(status));
}

/** Why the job stopped. Archiving is deliberately not one of these. */
export type JobStopReason = "cancelled" | "postponed";

export type AssignmentDisposition =
  /** Leave it alone — the studio has to handle this one itself. */
  | { action: "keep"; because: string }
  /** End it. `notify` is true only where somebody had agreed to work. */
  | { action: "withdraw"; notify: boolean };

/**
 * What to do with one assignment when the job stops.
 *
 * The split that matters is whether this person ever said yes:
 *
 *  - **They had not.** The offer is withdrawn quietly. Telling somebody an
 *    offer they never accepted has been withdrawn is noise, and the offer
 *    disappearing from their portal is the whole message.
 *  - **They had.** The assignment is ended *and* they are told, because they
 *    are holding a date. This is the case that makes the silence indefensible.
 *
 * A postponement keeps an accepted assignment. The date is moving, not gone,
 * and dropping a booked crew member because a couple shifted the wedding is a
 * conversation the studio has to have rather than a side effect: it may well
 * be the same person on the new date.
 */
export function dispositionFor(input: {
  reason: JobStopReason;
  status: string;
}): AssignmentDisposition {
  if (!isLiveAssignment(input.status))
    return { action: "keep", because: "already settled" };
  const accepted = input.status === "accepted";
  if (input.reason === "postponed" && accepted)
    return {
      action: "keep",
      because: "a booked crew member is re-agreed, not dropped",
    };
  return { action: "withdraw", notify: accepted };
}

/**
 * Whether a job can be filed away.
 *
 * Archiving is bookkeeping — it is how a studio clears a dead enquiry or a
 * duplicate — so it is allowed at any stage, and deliberately does not end
 * anything. That is exactly why it must not be allowed to hide a job somebody
 * is waiting on: the offer would stay live, invisible to the studio, and the
 * crew member would turn up.
 *
 * The same rule archiving a *client* already follows, for the same reason.
 * Cancel the job — which does end the offers, and records why — then archive.
 */
export function archiveBlockedBy(
  assignments: readonly { status: string; role?: string | null }[],
): { blocked: boolean; live: number; message: string | null } {
  const live = assignments.filter((item) => isLiveAssignment(item.status));
  if (!live.length) return { blocked: false, live: 0, message: null };
  const roles = [...new Set(live.map((item) => (item.role ?? "").trim()).filter(Boolean))];
  const who =
    roles.length === 1
      ? roles[0]!.toLocaleLowerCase()
      : `${live.length} crew`;
  return {
    blocked: true,
    live: live.length,
    message: `This job still has ${who} waiting on it. Cancel the job — that ends the offers and records why — or settle them first.`,
  };
}
