import { crewCloseoutMoment, type CloseoutMoment } from "@/features/crew/closeout-moment";
import { offerCanBeAnswered } from "@/features/crew/offer-moment";
import { splitUpcomingAndPast } from "@/features/ordering/attention";

/**
 * What a crew member's home page has to tell them. One derivation.
 *
 * The headline was built inline in the component from two clauses —
 * invitations to answer, a schedule to acknowledge — and closeout was never a
 * member of that list, so a shooter owed $800 opened the app to "Nothing needs
 * you right now." When closeout was added it was added inline too, a third
 * clause beside the others, in a component that also counted "past
 * assignments" its own way while the Jobs page counted them another.
 *
 * Every question the home page answers is answered here, once, as a pure
 * function over the assignment records — so `tests/crew-attention.test.ts` can
 * hold the rule that nothing his money depends on is ever left off the front
 * page, and so a fourth clause added later cannot quietly skip it.
 *
 * Sibling to `projectJourney` (studio) and `buildClientPortalExperience`
 * (couple), which is the point: each workspace now has exactly one "what
 * needs me" that a guard can drive.
 */

export type CrewAssignmentRecord = {
  id: string;
  status?: unknown;
  arrivalAt?: unknown;
  departureAt?: unknown;
  inviteExpiresAt?: unknown;
  currentScheduleVersion?: unknown;
  acknowledgedScheduleVersion?: unknown;
  closeout?: unknown;
};

export type CrewAttention<T extends CrewAssignmentRecord> = {
  /** Offers still open to answer — expired ones are not offers. */
  invitations: T[];
  /** An accepted job, still ahead, whose current schedule he has not read. */
  acknowledgementDue: T | null;
  /** Work records the studio is waiting on, with why. */
  closeoutsDue: Array<{ assignment: T; moment: CloseoutMoment }>;
  /** Everything whose date has gone — the same split the Jobs page uses. */
  behindThem: T[];
  /** The sentence at the top of the page. */
  headline: string;
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function crewAttention<T extends CrewAssignmentRecord>(
  assignments: readonly T[],
  now: Date,
): CrewAttention<T> {
  const invitations = assignments.filter((assignment) =>
    offerCanBeAnswered({
      status: text(assignment.status),
      inviteExpiresAt: text(assignment.inviteExpiresAt),
      arrivalAt: text(assignment.arrivalAt),
      now,
    }),
  );

  const endsAt = (assignment: T) =>
    text(assignment.departureAt) || text(assignment.arrivalAt);

  /**
   * A schedule acknowledgement only matters before the day. "Readiness
   * blocker · Acknowledge the current schedule" once led the page thirteen
   * days after that wedding was shot; acknowledging a run of show for an
   * event already over is not readiness.
   */
  const acknowledgementDue =
    assignments.find(
      (assignment) =>
        text(assignment.status) === "accepted" &&
        number(assignment.currentScheduleVersion) > 0 &&
        number(assignment.acknowledgedScheduleVersion) !==
          number(assignment.currentScheduleVersion) &&
        Date.parse(endsAt(assignment)) > now.valueOf(),
    ) ?? null;

  const closeoutsDue = assignments
    .map((assignment) => ({
      assignment,
      moment: crewCloseoutMoment({
        status: text(assignment.status),
        closeoutStatus: text(record(assignment.closeout).status),
        endsAt: endsAt(assignment),
        now,
      }),
    }))
    .filter((entry) => entry.moment.due);

  const behindThem = splitUpcomingAndPast(
    assignments,
    (assignment) => assignment.arrivalAt,
    now,
  ).past;

  const parts: string[] = [];
  if (invitations.length)
    parts.push(
      `${invitations.length} invitation${invitations.length === 1 ? "" : "s"} to answer`,
    );
  if (acknowledgementDue) parts.push("a schedule to acknowledge");
  if (closeoutsDue.length)
    parts.push(
      `${closeoutsDue.length} work record${closeoutsDue.length === 1 ? "" : "s"} to send in`,
    );

  return {
    invitations,
    acknowledgementDue,
    closeoutsDue,
    behindThem,
    headline: parts.length
      ? `You have ${parts.join(" and ")}.`
      : "Nothing needs you right now.",
  };
}
