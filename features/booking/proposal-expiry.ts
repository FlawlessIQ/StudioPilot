/**
 * When a proposal's validity window should actually start.
 *
 * The draft form defaults `expiresAt` to seven days from the moment it is
 * opened. Production, 2026-08-26: a proposal drafted on Aug 20 for an **October
 * 2027** wedding was still a draft, never sent, and expiring on Aug 28 — two days
 * away. A draft that sits for a week is ordinary; a proposal that expires before
 * the client has ever seen it is not.
 *
 * A validity window means "this offer stands for N days from when you receive
 * it", so the clock starts at send. This re-anchors it, and never shortens a
 * window the studio deliberately set longer.
 *
 * Pure, no I/O.
 */

/** The shortest window a client should get once a proposal is sent. */
export const MINIMUM_DAYS_AFTER_SEND = 7;

/**
 * The expiry to store when a proposal is sent.
 *
 * Returns the later of the studio's chosen expiry and
 * `MINIMUM_DAYS_AFTER_SEND` days from the send time — so an intentionally long
 * window survives, and a stale draft's window restarts.
 */
export function expiryOnSend(
  chosenExpiresAt: unknown,
  sentAt: Date,
  minimumDays: number = MINIMUM_DAYS_AFTER_SEND,
): string {
  const floor = new Date(sentAt.valueOf() + minimumDays * 86_400_000);
  const chosen =
    typeof chosenExpiresAt === "string" && chosenExpiresAt.trim()
      ? new Date(chosenExpiresAt)
      : null;
  if (!chosen || Number.isNaN(chosen.valueOf())) return floor.toISOString();
  return chosen.valueOf() > floor.valueOf()
    ? chosen.toISOString()
    : floor.toISOString();
}

/** Whether a stored expiry would have to be moved for this send to be sane. */
export function expiryNeedsReanchoring(
  chosenExpiresAt: unknown,
  sentAt: Date,
  minimumDays: number = MINIMUM_DAYS_AFTER_SEND,
): boolean {
  return (
    expiryOnSend(chosenExpiresAt, sentAt, minimumDays) !==
    (typeof chosenExpiresAt === "string" ? new Date(chosenExpiresAt).toISOString() : "")
  );
}
