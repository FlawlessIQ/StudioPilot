import { subscriptionAccess, type SubscriptionAccessRecord } from "./subscription-access.js";

/**
 * "Cue's first two weeks": three emails to a studio owner during the trial
 * (docs/positioning-office-manager-plan-2026-10-06.md, Outbound). Pure — the
 * daily billingNoticeScheduler (billing-notices.ts) reads the records and
 * queues what this says is due.
 *
 * - day 0: `trial_cue_starts` — what Cue does on its own, what it prepares,
 *   and the three things that make it useful first.
 * - day 2: `trial_cue_so_far` — what actually happened for this studio, from
 *   its own records; an honest "nothing yet" when nothing has.
 * - day 7: `trial_cue_without_asking` — the trust dial.
 *
 * Latest only: a scheduler that missed a day sends the step now due and skips
 * the ones before it, so a studio never gets two in a day or a "Cue starts
 * today" on day 6. Each step is one emailJob under a fixed id, so it is never
 * sent twice, and a trial extended in the Console does not restart the series.
 */

export const TRIAL_SERIES = [
  { step: "starts", type: "trial_cue_starts", fromDay: 0 },
  { step: "so_far", type: "trial_cue_so_far", fromDay: 2 },
  { step: "without_asking", type: "trial_cue_without_asking", fromDay: 7 },
] as const;

export type TrialSeriesStep = (typeof TRIAL_SERIES)[number]["step"];
export type TrialSeriesType = (typeof TRIAL_SERIES)[number]["type"];
export const TRIAL_SERIES_TYPES: readonly TrialSeriesType[] = TRIAL_SERIES.map((entry) => entry.type);

/** How long before a trial ends `billing_trial_ending` goes (billing-notices.ts). */
export const TRIAL_NOTICE_DAYS = 3;

/**
 * Consecutive unedited approvals before Cue offers to send a routine message
 * on its own. A copy of TRUST_DIAL_THRESHOLD in features/messaging/trust-dial.ts
 * (functions/ cannot import features/); tests/trial-series.test.ts compares them.
 */
export const TRUST_DIAL_APPROVALS = 3;

/** Stripe's trial length (stripe-checkout.ts), for a record with no period start. */
const TRIAL_LENGTH_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (value: unknown): string | null =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;

export type TrialSeriesRecord = SubscriptionAccessRecord & {
  comped?: unknown;
  currentPeriodStart?: unknown;
};

export type TrialSeriesDue = {
  step: TrialSeriesStep;
  type: TrialSeriesType;
  /** Whole days since the trial started. */
  day: number;
  trialStartedAt: string;
  trialEndsAt: string;
};

/**
 * When the trial started. While trialing, Stripe's period start is the trial
 * start; without one, count back from the end.
 */
export function trialStartedAt(record: TrialSeriesRecord, trialEndsAt: string): string {
  const start = iso(record.currentPeriodStart);
  if (start && Date.parse(start) < Date.parse(trialEndsAt)) return start;
  return new Date(Date.parse(trialEndsAt) - TRIAL_LENGTH_DAYS * DAY_MS).toISOString();
}

/**
 * The series email this subscription is owed now, or null.
 *
 * Only a trialing studio with full access: never comped, suspended, past due,
 * active (converted) or cancelled. Never once the trial has ended, and never
 * inside the last {@link TRIAL_NOTICE_DAYS} days plus one — that stretch
 * belongs to "Your trial ends", with a clear day either side.
 *
 * Returns the latest step whose day has come; whether it was already sent is
 * the emailJob id's business (see {@link trialSeriesJobId}).
 */
export function trialSeriesDue(record: TrialSeriesRecord | null | undefined, now: number): TrialSeriesDue | null {
  if (!record || record.comped === true) return null;
  const access = subscriptionAccess(record, now);
  if (access.status !== "trialing" || access.level !== "full" || !access.trialEndsAt) return null;
  const remaining = Date.parse(access.trialEndsAt) - now;
  if (remaining <= (TRIAL_NOTICE_DAYS + 1) * DAY_MS) return null;
  const startedAt = trialStartedAt(record, access.trialEndsAt);
  const elapsed = now - Date.parse(startedAt);
  if (elapsed < 0) return null;
  const day = Math.floor(elapsed / DAY_MS);
  const entry = [...TRIAL_SERIES].reverse().find((candidate) => day >= candidate.fromDay);
  if (!entry) return null;
  return { step: entry.step, type: entry.type, day, trialStartedAt: startedAt, trialEndsAt: access.trialEndsAt };
}

/** One per studio per step, ever. */
export function trialSeriesJobId(tenantId: string, step: TrialSeriesStep): string {
  return `trial_series_${tenantId}_${step}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400);
}

/** What Cue did for a studio since its trial started (the day-2 email). */
export type TrialActivity = {
  /** Inquiries that reached StudioCue (leads), not counting non-inquiries. */
  inquiries: number;
  /** Inquiry acknowledgments sent on Cue's own. */
  acknowledged: number;
  /** Scheduled reminders that went out (signing, forms, payments, crew…). */
  reminders: number;
  /** Every email sent to clients, crew, venues and agents. */
  emailsSent: number;
  /** Drafts Cue prepared for a decision. */
  drafted: number;
  /** Of those, approved. */
  approved: number;
  /** Waiting on the studio right now. */
  waiting: number;
};

type Row = Record<string, unknown>;

const after = (value: unknown, since: number) => {
  const at = iso(value);
  return at !== null && Date.parse(at) >= since;
};

/** An emailJob that actually went out: succeeded with a message id, not held. */
export function emailJobWasSent(job: Row): boolean {
  if (job.status !== "succeeded") return false;
  const result = job.result && typeof job.result === "object" ? (job.result as Row) : {};
  return typeof result.messageId === "string" && result.messageId.length > 0;
}

/** Mail to the studio itself, or StudioCue's own: not something Cue did for it. */
const NOT_ON_YOUR_BEHALF = /^(studio_|billing_|feedback_|trial_|platform_message$|daily_digest$|client_message_received$|staff_invitation$|email_verification$|password_reset$|sign_in_link$)/;

/** Prepared work: everything the model finished, whatever was decided. */
const PREPARED = new Set(["review_required", "approved", "rejected", "dismissed", "executed", "superseded"]);

/** Counts from the studio's own records. Every row is already tenant-scoped. */
export function summarizeTrialActivity(
  input: { leads: readonly Row[]; emailJobs: readonly Row[]; aiActions: readonly Row[] },
  sinceIso: string,
): TrialActivity {
  const since = Date.parse(sinceIso);
  const sent = input.emailJobs.filter((job) => after(job.createdAt, since) && emailJobWasSent(job));
  const typeOf = (job: Row) => (typeof job.type === "string" ? job.type : "");
  const actions = input.aiActions.filter((action) => after(action.createdAt, since));
  const decision = (action: Row) =>
    action.decision && typeof action.decision === "object" ? (action.decision as Row) : {};
  return {
    inquiries: input.leads.filter(
      (lead) => after(lead.createdAt, since) && lead.notInquiry !== true && !lead.archivedAt,
    ).length,
    acknowledged: sent.filter((job) => typeOf(job) === "inquiry_acknowledgement").length,
    reminders: sent.filter((job) => typeOf(job).endsWith("_reminder")).length,
    emailsSent: sent.filter((job) => !NOT_ON_YOUR_BEHALF.test(typeOf(job))).length,
    drafted: actions.filter((action) => PREPARED.has(String(action.status ?? ""))).length,
    approved: actions.filter(
      (action) =>
        decision(action).action === "approved" || action.status === "approved" || action.status === "executed",
    ).length,
    waiting: actions.filter((action) => action.status === "review_required" && !action.archivedAt).length,
  };
}

/** Nothing has happened yet: the day-2 email says so instead of inventing activity. */
export function trialActivityIsEmpty(activity: TrialActivity): boolean {
  return activity.inquiries === 0 && activity.emailsSent === 0 && activity.drafted === 0;
}
