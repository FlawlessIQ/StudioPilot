import type { DocumentSnapshot, Firestore, Transaction } from "firebase-admin/firestore";
import { journeyFor, projectProfile } from "../job-kinds/job-kinds.js";
import { tradeProfile } from "../trades/trades.js";
import { clientOutreachStop } from "./client-outreach.js";
import { reviewAskWrites } from "./release.js";

/**
 * Review asks after the day, for a trade that delivers nothing (simpler
 * vendor journeys, Phase 5).
 *
 * A photographer's asks start when the gallery goes out (release.ts). A DJ,
 * makeup artist or hair stylist has no gallery, so nothing ever scheduled
 * theirs: the job went from the day to the review step and sat there unless
 * the studio asked by hand. Now the move to EVENT_COMPLETE schedules the same
 * two asks — in the portal three days on, by email ten days on — through the
 * same helper, so the records, the scheduler and its stop rules are the ones
 * a delivery uses.
 *
 * The guards are a delivery's, read at the moment of the move:
 *
 * - the studio's review link, from its saved links. With none, the job
 *   records that it finished without review asks, as a delivery with no link
 *   does, so closeout does not wait on one;
 * - "Don't ask this couple" (`reviewRequestsSkippedAt`);
 * - clientOutreachStop: a job put away, called off, on hold, or a quiet
 *   imported booking (ADR 0005) is never asked. The scheduler checks again as
 *   each ask goes, because a job can be filed away in the days between.
 */

/**
 * A studio's saved review links: the one it set in Settings first
 * (saas/branding.ts writes `custom`), then the order the delivery form offers.
 */
const REVIEW_LINKS: ReadonlyArray<readonly [field: string, label: string]> = [
  ["custom", "custom"],
  ["google", "google"],
  ["weddingwire", "weddingwire"],
  ["theKnot", "the_knot"],
  ["facebook", "facebook"],
];

/** The studio's first saved review link, or null when it has none. */
export function studioReviewDestination(tenant: unknown): { url: string; label: string } | null {
  const links = ((tenant ?? {}) as { reviewLinks?: unknown }).reviewLinks;
  if (!links || typeof links !== "object") return null;
  for (const [field, label] of REVIEW_LINKS) {
    const value = (links as Record<string, unknown>)[field];
    // A delivery's link must be a real web address (release.ts); a saved one
    // from an import is held to the same.
    if (typeof value === "string" && /^https:\/\/\S+$/.test(value.trim())) return { url: value.trim(), label };
  }
  return null;
}

export type AfterDayReviewPlan =
  | { schedule: true; destinationUrl: string; destinationLabel: string }
  | {
      schedule: false;
      reason:
        /** The trade delivers something: the delivery schedules the asks. */
        | "delivers"
        /** The job's journey asks after a delivery, not after the day. */
        | "not_after_day"
        /** Put away, called off, on hold, or a quiet imported booking. */
        | "outreach_stopped"
        /** The studio said not to ask this client. */
        | "skipped"
        /** The studio has no review link saved. */
        | "no_review_link";
    };

/** Pure: whether the move to EVENT_COMPLETE schedules this job's review asks, and where they point. */
export function afterDayReviewPlan(project: unknown, tenant: unknown): AfterDayReviewPlan {
  const trade = tradeProfile(((tenant ?? {}) as { trade?: unknown }).trade);
  if (trade.delivery) return { schedule: false, reason: "delivers" };
  if (!journeyFor(projectProfile(project), trade).reviewAfterDay) return { schedule: false, reason: "not_after_day" };
  if (clientOutreachStop(project)) return { schedule: false, reason: "outreach_stopped" };
  if (typeof ((project ?? {}) as { reviewRequestsSkippedAt?: unknown }).reviewRequestsSkippedAt === "string")
    return { schedule: false, reason: "skipped" };
  const destination = studioReviewDestination(tenant);
  if (!destination) return { schedule: false, reason: "no_review_link" };
  return { schedule: true, destinationUrl: destination.url, destinationLabel: destination.label };
}

/**
 * The review asks for a job reaching EVENT_COMPLETE, inside the caller's
 * transaction (crm/commands.ts transitionProject, the one route to that
 * state: the journey's "Yes, we played it", the "did this go ahead?" answer
 * and a manual move all go through it).
 *
 * Reads first and returns the writes, the fields for the caller's own update
 * of the project, and how many asks were scheduled. A photographer's job
 * reads nothing and gets nothing.
 */
export async function afterDayReviewAsks(
  db: Firestore,
  transaction: Transaction,
  input: { project: DocumentSnapshot; tenant: DocumentSnapshot; actorId: string; now: string },
): Promise<{
  plan: AfterDayReviewPlan;
  scheduled: number;
  projectFields: Record<string, unknown>;
  writes: Array<() => void>;
}> {
  const plan = afterDayReviewPlan(input.project.data(), input.tenant.data());
  if (!plan.schedule) {
    return {
      plan,
      scheduled: 0,
      // As a delivery with no review link records it (release.ts): the job
      // finished without review asks, so closeout and the journey move on.
      projectFields:
        plan.reason === "no_review_link"
          ? {
              reviewRequestsSkippedAt: input.now,
              reviewRequestsSkippedBy: input.actorId,
              reviewRequestsSkippedReason: "no_review_link",
            }
          : {},
      writes: [],
    };
  }
  const asks = await reviewAskWrites(db, transaction, {
    tenantId: String(input.project.get("tenantId") ?? ""),
    projectId: input.project.id,
    actorId: input.actorId,
    now: input.now,
    deliveryRecordId: null,
    destinationUrl: plan.destinationUrl,
    destinationLabel: plan.destinationLabel,
    skipReviews: false,
    // No gallery to come back to: both asks by email.
    channels: ["email", "email"],
  });
  return {
    plan,
    scheduled: asks.scheduled,
    // What the journey's Review step reads: the asks are on their way, with
    // nothing for the studio to do (use-project-journey.ts).
    projectFields: asks.scheduled ? { reviewRequestsScheduledAt: input.now } : {},
    writes: asks.writes,
  };
}
