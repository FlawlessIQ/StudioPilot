/**
 * When a couple's form saves itself, and when it stops trying.
 *
 * Both of their forms — the one on the inquiry link and the one in the portal
 * — retried a failed autosave every second or so without end. On 2026-10-07 a
 * deleted job left Albert's inquiry form sending ~400 refused saves in ten
 * minutes while it still said "Saving shortly…". A refusal no retry can change
 * stops the form and says why; anything else waits longer each time.
 */

/** The pause before the next autosave: the base, then doubling to a minute. */
export function autosaveDelayMs(failures: number, baseMs = 1_500): number {
  return Math.min(baseMs * 2 ** Math.max(0, failures), 60_000);
}

/**
 * Why the portal form can't save any more, in the couple's words, or null when
 * trying again may work (a dropped connection, a server hiccup).
 *
 * Not the studio's own error copy: "Ask the studio owner or an admin" means
 * nothing to a couple, and the studio's billing is not theirs to hear about.
 */
export function portalSaveStop(code: string): string | null {
  if (code === "RESPONSE_NOT_FOUND")
    return "This form isn’t available any more, so your latest answers weren’t saved. Your studio may have replaced it — message them if you’re not sure.";
  if (code === "AUTHENTICATION_REQUIRED" || code === "Sign in before changing planning records.")
    return "You’ve been signed out, so your latest answers weren’t saved. Sign in again to carry on.";
  if (code === "FORBIDDEN")
    return "This form can’t be saved from your account any more, so your latest answers weren’t saved. Message your studio.";
  if (
    code === "STUDIO_SUSPENDED" ||
    code === "SUBSCRIPTION_READ_ONLY" ||
    code === "ACTIVE_SUBSCRIPTION_REQUIRED" ||
    code.startsWith("ENTITLEMENT_REQUIRED")
  )
    return "Your studio can’t take changes here right now, so your latest answers weren’t saved. Message them directly.";
  return null;
}
