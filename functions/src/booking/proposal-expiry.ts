/**
 * Proposal expiry — mirror.
 *
 * `functions/` is a separate package and cannot import from `features/`, so this
 * mirrors features/booking/proposal-expiry.ts. That copy holds the tests and is
 * the source of truth; change both together.
 */

export const MINIMUM_DAYS_AFTER_SEND = 7;

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
