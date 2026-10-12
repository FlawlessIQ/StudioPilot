import { finalDetailsLockApplies } from "@/features/job-kinds/job-kinds";
import { finalDetailsDue } from "@/features/planning/final-details-due";
import { detailsLockOn, resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import { clientOutreachStop } from "@/features/post-event/client-outreach";
import { headcountNames } from "@/features/schedules/party-list";
import { tradeOf } from "@/features/trades/trades";

/**
 * Where a per-person client's final headcount stands (makeup, hair; trades.ts
 * `perPersonPricing`), in the shape the journey's final step reads
 * (features/journey/steps.ts `finalCall`, which titles it "Final headcount").
 *
 * There is no call to book. When the details lock, the client is asked
 * "still this many getting ready?" and confirms in one tap
 * (functions/src/planning/final-details.ts opens a `kind: "headcount"`
 * sign-off; server/planning/final-details.ts records the tap). Confirmed is
 * "held", which the step shows as Confirmed. Unlike the final details call it
 * does not wait on the studio's call setting: the headcount is asked whenever
 * the details lock. Null when the job has no lock (job-kinds.ts).
 *
 * Waiting on the client ("invited") only once the sign-off is open. The date
 * alone said so for a lead dated inside the lock window, before anything had
 * gone (Priya Shah's sangeet, Jess Styles Bridal, 2026-10-12). Past the lock
 * with nothing open, it says when it goes (final-details-due.ts): within the
 * day, or — with no party list back yet, since there is no headcount without
 * one — when the list is in. Not booked yet, it goes once they have booked
 * and the list is in: booking alone never asks it (Priya was a lead with no
 * list back).
 */
export type FinalHeadcountState = {
  state: "not_yet" | "at_booking" | "due" | "needs_party_list" | "paused" | "invited" | "held";
  lockOn: string | null;
  startsAt: null;
};

type Row = Record<string, unknown>;

const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};

/**
 * The client's party list as it came back, as they wrote it: of their
 * returned forms, oldest first, the newest answer to "party-list" with
 * anything in it (party-list.ts `newestPartyNames`). Empty when none has.
 */
export function returnedPartyList(responses: readonly Row[]): string {
  let list = "";
  const answers = responses
    .filter((response) => ["submitted", "locked"].includes(String(response.status)) && !response.archivedAt)
    .sort((left, right) => String(left.submittedAt ?? "").localeCompare(String(right.submittedAt ?? "")))
    .map((response) => record(response.answers)["party-list"]);
  for (const value of answers) if (typeof value === "string" && value.trim()) list = value;
  return list;
}

/**
 * The names on the client's returned party list, counted as the sign-off
 * counts them (functions/src/planning/final-details.ts `partyPeople`): their
 * returned forms oldest first, the newest list wins, only those having the
 * studio's own service.
 */
export function returnedPartyNames(responses: readonly Row[], trade: unknown): string[] {
  return headcountNames(returnedPartyList(responses), tradeOf(trade) === "hair" ? "hair" : "makeup");
}

export function finalHeadcountState(input: {
  project: Row | null | undefined;
  planningTimeline: unknown;
  /** The job's `detailSignoffs` record, if the lock has opened one. */
  signoff: Row | null | undefined;
  /** The job's questionnaire responses: whether a party list has come back. */
  responses?: readonly Row[];
  /** The studio's trade, for whose service the party list is counted. */
  trade?: unknown;
  /** YYYY-MM-DD */
  today: string;
}): FinalHeadcountState | null {
  if (!input.project || !finalDetailsLockApplies(input.project)) return null;
  const lockOn = detailsLockOn(String(input.project.eventDate ?? ""), resolvePlanningTimeline(input.planningTimeline));
  const at = (state: FinalHeadcountState["state"]): FinalHeadcountState => ({ state, lockOn, startsAt: null });
  if (input.signoff?.status === "confirmed") return at("held");
  if (input.signoff) return at("invited");
  const due = finalDetailsDue({
    state: input.project.state,
    quiet: clientOutreachStop(input.project) !== null,
    eventDate: input.project.eventDate,
    lockOn,
    today: input.today,
  });
  if (due === "quiet") return at("paused");
  if (due === "not_booked") return at("at_booking");
  if (due === "due") return at(returnedPartyNames(input.responses ?? [], input.trade).length ? "due" : "needs_party_list");
  return at("not_yet");
}
