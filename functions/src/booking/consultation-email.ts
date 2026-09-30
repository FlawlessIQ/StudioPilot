import type { Firestore } from "firebase-admin/firestore";
import { inquiryLinkFor, studioTakesBookings } from "../intake/inquiry-link.js";

/**
 * Consultation emails are rendered from the consultation, as it is when the
 * email goes — not as it was when the email was queued.
 *
 * The confirmation used to be queued at booking with `location: null` and a
 * copy of `startsAt`, and rendered from that copy. The Zoom meeting is made
 * later, by the provider worker (create_consultation_resources), so the one
 * email whose job was to carry the join link never could: the settings page
 * promised "A Zoom link goes out with the confirmation" and the couple got
 * "We'll share any final meeting details before the appointment".
 *
 * So the email worker reads the consultation at send time, and a confirmation
 * for a video call whose meeting is still being made waits for it — by
 * throwing a retryable failure, which the job runner turns into a short
 * backoff (30s, 60s, …). It never waits past its last attempt: then it goes
 * with "we'll send the link", because a confirmation without a link is better
 * than no confirmation. A consultation that was cancelled or moved before its
 * email went is not confirmed at all.
 *
 * Pure apart from `consultationEmailPlanFor`, so the rules are tested directly
 * (tests/wave0-consult-inquiry.test.ts).
 */

export const CONSULTATION_EMAIL_TYPES: readonly string[] = [
  "consultation_confirmation",
  "consultation_reminder",
  "consultation_rescheduled",
  "consultation_cancelled",
];

/** The meeting is still being made by the provider worker. */
export const CONSULTATION_MEETING_PENDING = "CONSULTATION_MEETING_PENDING";

/** Provider states that mean create_consultation_resources has not finished. */
const RESOURCES_IN_FLIGHT = new Set(["queued", "meeting_created", "calendar_created"]);

export type ConsultationEmailPlan =
  | { kind: "send"; values: Record<string, unknown> }
  | { kind: "hold"; reason: string }
  | { kind: "wait" };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function consultationEmailPlan(input: {
  type: string;
  /** The email job's own fields — what was true when it was queued. */
  job: Record<string, unknown>;
  /** The consultation now, or null when the job names none (older jobs). */
  consultation: Record<string, unknown> | null;
  /** The create_consultation_resources job's status, when there is one. */
  resourcesJobStatus: string | null;
  /** This attempt, counting from 1, and how many the runner allows. */
  attempt: number;
  maxAttempts: number;
}): ConsultationEmailPlan {
  const { type, job, consultation } = input;
  if (!consultation) return { kind: "send", values: {} };
  const status = text(consultation.status);
  if (type === "consultation_cancelled") {
    // Cancelling is final, so anything else means the job names the wrong
    // consultation — and "it's cancelled" about a meeting that is on is worse
    // than silence.
    if (status !== "cancelled") return { kind: "hold", reason: "consultation_not_cancelled" };
  } else if (status !== "scheduled") {
    // Cancelled, held, or replaced by the couple before this went out:
    // confirming or reminding would send them to a meeting that isn't on.
    return { kind: "hold", reason: `consultation_${status || "missing"}` };
  }
  // A second move before the first move's email went: that later move has its
  // own email, and two "new time" emails would disagree with each other.
  if (
    type === "consultation_rescheduled" &&
    text(job.startsAt) &&
    text(job.startsAt) !== text(consultation.startsAt)
  ) {
    return { kind: "hold", reason: "superseded_by_later_move" };
  }
  const mode = text(consultation.mode);
  const joinUrl = text(consultation.joinUrl);
  const zoomExpected = mode === "zoom" && !joinUrl;
  if (
    zoomExpected &&
    type !== "consultation_cancelled" &&
    RESOURCES_IN_FLIGHT.has(text(consultation.providerState)) &&
    !["dead_letter", "succeeded"].includes(input.resourcesJobStatus ?? "") &&
    input.attempt < input.maxAttempts
  ) {
    return { kind: "wait" };
  }
  const values: Record<string, unknown> = {
    startsAt: text(consultation.startsAt) || text(job.startsAt),
    meetingMode: mode || null,
    joinUrl: joinUrl || null,
    location: joinUrl || text(consultation.location) || text(job.location) || null,
    // A video call with no link yet: Zoom isn't connected, or making the
    // meeting failed. The email says the studio will send it, rather than
    // implying there is nothing to join.
    meetingDetailsPending: zoomExpected,
  };
  const selfServe = text(consultation.selfServeUrl);
  if (selfServe && !text(job.rescheduleUrl)) values.rescheduleUrl = selfServe;
  return { kind: "send", values };
}

/** The consultation a consultation email is about, from its field or its id. */
export function consultationIdOfEmailJob(jobId: string, job: Record<string, unknown>): string | null {
  const named = text(job.consultationId);
  if (named) return named;
  // Jobs queued before the field existed: `consultation_confirmation_<id>`.
  const match = /^consultation_confirmation_(consultation_.+)$/.exec(jobId);
  return match ? match[1]! : null;
}

/** The plan for one email job, reading what it needs. */
export async function consultationEmailPlanFor(
  db: Firestore,
  input: { jobId: string; job: Record<string, unknown>; attempt: number; maxAttempts: number },
): Promise<ConsultationEmailPlan> {
  const consultationId = consultationIdOfEmailJob(input.jobId, input.job);
  if (!consultationId) return { kind: "send", values: {} };
  const [consultation, resourcesJob] = await Promise.all([
    db.doc(`consultations/${consultationId}`).get(),
    db.doc(`providerJobs/consultation_${consultationId}`).get(),
  ]);
  const owned = consultation.exists && consultation.get("tenantId") === input.job.tenantId;
  return consultationEmailPlan({
    type: text(input.job.type),
    job: input.job,
    consultation: owned ? (consultation.data() ?? null) : null,
    resourcesJobStatus: resourcesJob.exists ? text(resourcesJob.get("status")) : null,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
  });
}

/**
 * The couple's own inquiry page (/i/…) for this job, where they can see,
 * move or rebook their call — or null when the job has no inquiry behind it
 * (made by hand) or the studio has no hours for the page to offer.
 */
export async function coupleInquiryUrl(
  db: Firestore,
  input: { tenantId: string; projectId: string; now: string },
): Promise<string | null> {
  const leads = await db
    .collection("leads")
    .where("tenantId", "==", input.tenantId)
    .where("projectId", "==", input.projectId)
    .limit(5)
    .get();
  const lead = leads.docs.find((document) => document.get("notInquiry") !== true);
  if (!lead || !(await studioTakesBookings(db, input.tenantId))) return null;
  return inquiryLinkFor(db, { tenantId: input.tenantId, leadId: lead.id, now: input.now });
}
