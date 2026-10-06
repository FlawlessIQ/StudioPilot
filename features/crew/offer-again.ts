/**
 * Who a studio can offer a job to again.
 *
 * GR Productions (2026-10-06): "albert missed his invite? Need to be able to
 * resend or manually put in. I cant." Albert's offer ran out after 24 hours
 * with nobody else on the list, and both ways back to him were shut:
 *
 *  - "I know who I want" left out anyone with an offer on the job unless it
 *    was declined or cancelled, so an *expired* offer hid him for good.
 *  - "Offer to someone else" ruled out everyone the round had already asked,
 *    so it offered the role to nobody.
 *
 * Silence is not a no. An offer that lapsed leaves the person askable; only
 * one they turned down (or the studio withdrew) is a reason to skip them —
 * and even then only for the round the studio plans next, not for a direct
 * offer, where the studio has named them on purpose.
 */

/** Offers that are over: the person holds nothing on the job through them. */
const OVER = new Set(["declined", "cancelled", "expired", "reassigned"]);

/** A crewAssignments document, read loosely: projectId, crewProfileId, status. */
export type OfferRecord = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");

export function offerIsOver(status: unknown): boolean {
  return OVER.has(text(status));
}

/** People with a live offer or booking on this job — not offerable twice. */
export function spokenForOnJob(
  assignments: readonly OfferRecord[],
  projectId: string,
): Set<string> {
  const taken = new Set<string>();
  for (const item of assignments) {
    if (text(item.projectId) !== projectId || offerIsOver(item.status)) continue;
    const id = text(item.crewProfileId);
    if (id) taken.add(id);
  }
  return taken;
}

/** People whose offer on this job lapsed, and who hold nothing live on it. */
export function lapsedOnJob(
  assignments: readonly OfferRecord[],
  projectId: string,
): Set<string> {
  const live = spokenForOnJob(assignments, projectId);
  const lapsed = new Set<string>();
  for (const item of assignments) {
    if (text(item.projectId) !== projectId || text(item.status) !== "expired") continue;
    const id = text(item.crewProfileId);
    if (id && !live.has(id)) lapsed.add(id);
  }
  return lapsed;
}
