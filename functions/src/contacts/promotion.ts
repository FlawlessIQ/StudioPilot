/**
 * The prospect→client promotion rule, applied when a project is booked.
 *
 * A contact created from a lead carries `["prospect"]`. Booking makes them a
 * client, but nothing promoted them, so a booked couple never appeared in the
 * Clients directory (which lists `contactTypes.includes("client")`) — see P22.
 *
 * Promotion adds "client" and drops "prospect" (they've converted), preserving
 * any other types, and de-duplicates. It is idempotent: a contact that is
 * already a client with no prospect flag comes back unchanged. Never returns an
 * empty list — "client" is always present — so the contact schema's non-empty
 * `contactTypes` invariant holds.
 */
export function promoteContactTypesToClient(existing: readonly string[]): string[] {
  return Array.from(
    new Set([...existing.filter((type) => type !== "prospect"), "client"]),
  );
}

/** Whether promotion would change anything, so a no-op write can be skipped. */
export function alreadyClientOnly(existing: readonly string[]): boolean {
  return existing.includes("client") && !existing.includes("prospect");
}
