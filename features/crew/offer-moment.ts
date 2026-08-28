/**
 * Whether a crew offer is still answerable, and if not, why.
 *
 * `crewCommand` refuses `respondAssignment` once `inviteExpiresAt` has gone by,
 * which is right. Nothing in the crew workspace knew that: an offer whose
 * deadline had lapsed 26 days earlier, for a wedding that had been shot 6 days
 * earlier, was still presented as "Response requested" with live Accept and
 * Decline buttons — filed, on the Jobs page, under the heading "Finished work".
 * Pressing Accept produced a refusal.
 *
 * A UI that offers what the server will refuse is worse than one that offers
 * nothing: the crew member does the work of deciding and gets punished for it.
 *
 * Pure predicate, no I/O.
 */

export type OfferLapse = "expired" | "event_passed" | null;

const PENDING: readonly string[] = ["invited", "viewed"];

export function offerIsPending(status: string): boolean {
  return PENDING.includes(status);
}

/**
 * Why this offer can no longer be taken up.
 *
 * Expiry is checked first because it is the condition the server enforces, and
 * so the one whose wording has to match the refusal the crew member would have
 * hit. A lapsed date with the event still ahead is recoverable — the studio can
 * re-offer it — where an event already behind them is not.
 */
export function offerLapse(input: {
  status: string;
  inviteExpiresAt?: string | null;
  arrivalAt?: string | null;
  now: Date;
}): OfferLapse {
  if (!offerIsPending(input.status)) return null;
  const expires = input.inviteExpiresAt
    ? Date.parse(input.inviteExpiresAt)
    : Number.NaN;
  if (Number.isFinite(expires) && expires <= input.now.valueOf()) {
    return "expired";
  }
  const arrival = input.arrivalAt ? Date.parse(input.arrivalAt) : Number.NaN;
  if (Number.isFinite(arrival) && arrival <= input.now.valueOf()) {
    return "event_passed";
  }
  return null;
}

export function offerCanBeAnswered(input: {
  status: string;
  inviteExpiresAt?: string | null;
  arrivalAt?: string | null;
  now: Date;
}): boolean {
  return offerIsPending(input.status) && offerLapse(input) === null;
}

/** What to tell the crew member instead of offering them a dead button. */
export function offerLapseNotice(lapse: Exclude<OfferLapse, null>): {
  title: string;
  detail: string;
} {
  return lapse === "expired"
    ? {
        title: "This offer has expired",
        detail:
          "The studio's response deadline has passed, so it can no longer be accepted. Message them if you are still available and they can re-offer it.",
      }
    : {
        title: "This date has already passed",
        detail:
          "The event was before today, so there is nothing left to accept. Message the studio if you believe this is wrong.",
      };
}
