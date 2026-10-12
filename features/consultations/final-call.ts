import { finalDetailsLockApplies } from "@/features/job-kinds/job-kinds";
import { finalDetailsDue } from "@/features/planning/final-details-due";
import { detailsLockOn, resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { clientOutreachStop } from "@/features/post-event/client-outreach";
import { isLiveConsultation } from "@/features/consultations/live";
import { isFinalDetailsCall } from "@/features/consultations/purpose";

/**
 * Where a job's final details call stands, for its journey step.
 *
 * The details lock (functions/src/planning/final-details.ts) sends the couple
 * a link to book it; booking makes a `consultations` record with
 * `purpose: "final_details"`. Null when the job has none: the studio turned
 * it off, or the job isn't a wedding (no lock, no call).
 *
 * Invited — waiting on the couple — only once that link has gone: the
 * sign-off it goes out with is open and carries it (`finalCallLinkId`; a
 * sign-off opened before that field existed is taken to have sent it). The
 * date alone said "invited" for a lead dated inside the lock window, before
 * anything had gone (Jess Styles Bridal, 2026-10-12). Past the lock with
 * nothing open, it says when it goes (final-details-due.ts); a sign-off that
 * went with no link (nobody to send it to) says so, for the studio to invite
 * them by hand.
 */
export type FinalCallState = {
  state: "not_yet" | "at_booking" | "due" | "paused" | "not_sent" | "invited" | "booked" | "held";
  lockOn: string | null;
  startsAt: string | null;
};

type Row = Record<string, unknown>;

export function finalCallState(input: {
  project: Row | null | undefined;
  planningTimeline: unknown;
  consultations: readonly Row[];
  /** The job's `detailSignoffs` record, if the lock has opened one. */
  signoff?: Row | null;
  /** YYYY-MM-DD */
  today: string;
  /** ISO, for "has it happened". */
  now: string;
}): FinalCallState | null {
  if (!input.project || !finalDetailsLockApplies(input.project)) return null;
  const timeline = resolvePlanningTimeline(input.planningTimeline);
  if (!timeline.finalCall) return null;
  const lockOn = detailsLockOn(String(input.project.eventDate ?? ""), timeline);
  const call = input.consultations
    .filter((record) => isFinalDetailsCall(record) && isLiveConsultation(record))
    .sort((left, right) => String(right.startsAt ?? "").localeCompare(String(left.startsAt ?? "")))[0];
  if (call) {
    const startsAt = String(call.startsAt ?? "") || null;
    const held = call.status === "completed" || (startsAt !== null && startsAt <= input.now);
    return { state: held ? "held" : "booked", lockOn, startsAt };
  }
  const at = (state: FinalCallState["state"]): FinalCallState => ({ state, lockOn, startsAt: null });
  if (input.signoff) return at(input.signoff.finalCallLinkId === null ? "not_sent" : "invited");
  const due = finalDetailsDue({
    state: input.project.state,
    quiet: clientOutreachStop(input.project) !== null,
    eventDate: input.project.eventDate,
    lockOn,
    today: input.today,
  });
  if (due === "quiet") return at("paused");
  if (due === "not_booked") return at("at_booking");
  if (due === "due") return at("due");
  return at("not_yet");
}
