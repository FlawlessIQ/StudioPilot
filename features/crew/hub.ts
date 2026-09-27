/**
 * The decisions behind the Crew page's hub (components/crew/crew-hub.tsx):
 * which list an assignment belongs in, what to say about a person's account,
 * and how much of an offer's paperwork is done. Plain functions so they can be
 * tested without a browser.
 */

export type AssignmentBucket = "upcoming" | "waiting" | "closed";

const CLOSED = new Set(["declined", "expired", "reassigned", "cancelled", "completed"]);
const WAITING = new Set(["draft", "invited", "viewed"]);

/**
 * Upcoming: accepted work still ahead. Waiting: offered, not yet answered.
 * Closed: answered no, withdrawn, done, or the day has passed. Cancelled offers
 * used to sit in the one list among the live ones, so the work that mattered
 * was found by reading past the work that didn't.
 */
export function assignmentBucket(
  status: string,
  arrivalAt: string,
  now: number,
): AssignmentBucket {
  if (CLOSED.has(status)) return "closed";
  const arrival = Date.parse(arrivalAt);
  // A day's grace: a wedding still under way this evening is not "past".
  if (Number.isFinite(arrival) && arrival < now - 24 * 60 * 60 * 1000) return "closed";
  return WAITING.has(status) ? "waiting" : "upcoming";
}

export function crewAccountLabel(profile: Record<string, unknown>): { label: string; tone: "success" | "info" | "neutral" | "warning" } {
  if (profile.active === false) return { label: "Inactive", tone: "neutral" };
  if (typeof profile.userId === "string" && profile.userId) return { label: "Joined", tone: "success" };
  if (profile.inviteStatus === "invited") return { label: "Invite sent", tone: "info" };
  return { label: "Not invited", tone: "neutral" };
}

/** Required paperwork on an offer, and how much is complete or waived. */
export function paperworkProgress(requirements: unknown): { done: number; total: number } {
  const items = Array.isArray(requirements)
    ? requirements.filter(
        (item): item is { required?: unknown; status?: unknown } =>
          typeof item === "object" && item !== null,
      )
    : [];
  const required = items.filter((item) => item.required !== false);
  return {
    done: required.filter((item) => item.status === "complete" || item.status === "waived").length,
    total: required.length,
  };
}
