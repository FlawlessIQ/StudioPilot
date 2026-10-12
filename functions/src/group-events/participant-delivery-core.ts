import { createHash } from "node:crypto";
import { clientOutreachStop } from "../post-event/client-outreach.js";
import { studioReviewDestination } from "../post-event/after-day-reviews.js";
import { participantDelivered, participantDeliveryState, type ParticipantDelivery } from "./delivery.js";

/**
 * Each parent's delivery and review ask at a group event — the pure rules
 * (participant-delivery.ts does the Firestore half; crmCommand releases).
 *
 * - `group_delivery`: the studio released a parent's link. One email per
 *   place per link: its id is made from the link, so a second press sends
 *   nothing and a replaced link sends once more. Read again as it goes: a
 *   cancelled place, a job put away or called off, or a link replaced since
 *   holds it (the new link has its own email).
 * - `group_review_request`: one ask per parent, ever, some days after their
 *   delivery, from the hourly review sweep (post-event/jobs.ts). Its id is
 *   the participant's. Held when the studio has no review link, said not to
 *   ask (`reviewRequestsSkippedAt` on the job), or the job or place has gone.
 */

export const GROUP_DELIVERY_EMAIL = "group_delivery";
export const GROUP_REVIEW_EMAIL = "group_review_request";

/**
 * What a group event delivers, in the email's words. Delivery is offered only
 * to a studio whose trade delivers (a photographer's), so this is theirs.
 */
export const GROUP_DELIVERED_NOUN = "photos";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** One email per place per link. */
export function groupDeliveryJobId(participantId: string, url: string): string {
  return `group_delivery_${participantId}_${createHash("sha256").update(url.trim()).digest("hex").slice(0, 16)}`;
}

/** One review ask per parent, ever. */
export const groupReviewJobId = (participantId: string) => `group_review_${participantId}`;

const asParticipant = (row: Row) => ({
  status: text(row.status),
  amountCents: Number(row.amountCents ?? 0),
  email: text(row.email) || null,
  delivery: (row.delivery ?? null) as ParticipantDelivery | null,
});

export type GroupMailPlan = { hold: string } | { values: Record<string, unknown> };

/** Stops that hold a delivery email: put away, called off, on hold. A quiet (imported) job's studio pressed release itself. */
function deliveryStop(project: Row): string | null {
  const stop = clientOutreachStop(project);
  return stop && stop !== "automations_paused" ? stop : null;
}

/** At send time: the delivery email, or why it waits. */
export function participantDeliveryPlan(input: { job: Row; project: Row | null; participant: Row | null }): GroupMailPlan {
  const { job, project, participant } = input;
  if (!project) return { hold: "job_missing" };
  const stop = deliveryStop(project);
  if (stop) return { hold: stop };
  if (!participant || text(participant.status) === "cancelled") return { hold: "participant_cancelled" };
  const delivery = record(participant.delivery);
  const url = text(job.galleryUrl);
  if (!url || text(delivery.url) !== url || text(delivery.releasedUrl) !== url) return { hold: "link_replaced" };
  return {
    values: {
      galleryUrl: url,
      athleteName: text(participant.athleteName) || null,
      deliveredNoun: GROUP_DELIVERED_NOUN,
    },
  };
}

export type ReviewAskDecision =
  | { send: true; destinationUrl: string; destinationLabel: string }
  | { send: false; reason: string };

/**
 * Whether a parent's review ask goes now (the sweep), and where it points:
 * the studio's saved review link, as a wedding's after-day ask uses.
 */
export function participantReviewDecision(input: {
  project: Row | null;
  participant: Row | null;
  tenant: Row | null;
  now: string;
}): ReviewAskDecision {
  const { project, participant } = input;
  if (!project) return { send: false, reason: "job_missing" };
  const stop = clientOutreachStop(project);
  if (stop) return { send: false, reason: stop };
  if (typeof project.reviewRequestsSkippedAt === "string") return { send: false, reason: "skipped" };
  if (record(project.groupEvent).enabled !== true) return { send: false, reason: "no_roster" };
  if (!participant) return { send: false, reason: "participant_missing" };
  const shaped = asParticipant(participant);
  if (shaped.status === "cancelled") return { send: false, reason: "participant_cancelled" };
  if (!participantDelivered(shaped)) return { send: false, reason: "not_delivered" };
  if (!text(participant.email).includes("@")) return { send: false, reason: "no_email" };
  const ask = record(participant.reviewAsk);
  if (ask.state !== "scheduled") return { send: false, reason: "not_scheduled" };
  if (text(ask.dueAt) > input.now) return { send: false, reason: "not_yet" };
  const destination = studioReviewDestination(input.tenant);
  if (!destination) return { send: false, reason: "no_review_link" };
  return { send: true, destinationUrl: destination.url, destinationLabel: destination.label };
}

/** At send time: the review ask, or why it waits. Read again, because days may have passed in a retry or a billing hold. */
export function participantReviewPlan(input: { job: Row; project: Row | null; participant: Row | null }): GroupMailPlan {
  const { job, project, participant } = input;
  if (!project) return { hold: "job_missing" };
  const stop = clientOutreachStop(project);
  if (stop) return { hold: stop };
  if (typeof project.reviewRequestsSkippedAt === "string") return { hold: "review_requests_skipped" };
  if (!participant || text(participant.status) === "cancelled") return { hold: "participant_cancelled" };
  if (participantDeliveryState(asParticipant(participant)) === "none") return { hold: "not_delivered" };
  const destinationUrl = text(job.destinationUrl);
  if (!/^https:\/\/\S+$/.test(destinationUrl)) return { hold: "no_review_link" };
  return {
    values: {
      destinationUrl,
      athleteName: text(participant.athleteName) || null,
      deliveredNoun: GROUP_DELIVERED_NOUN,
    },
  };
}
