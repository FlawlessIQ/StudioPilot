import { getAuth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { studioNotificationAddress } from "../communications/notify-address.js";
import { subscriptionAccessRecord } from "./entitlement-guard.js";
import { PAST_DUE_GRACE_DAYS, subscriptionAccess } from "./subscription-access.js";
import {
  TRIAL_NOTICE_DAYS,
  TRUST_DIAL_APPROVALS,
  summarizeTrialActivity,
  trialActivityIsEmpty,
  trialSeriesDue,
  trialSeriesJobId,
  type TrialActivity,
  type TrialSeriesType,
} from "./trial-series.js";

export { TRIAL_NOTICE_DAYS };

/**
 * The emails StudioCue sends a studio owner about their own subscription.
 *
 * AdHelm and ScoreOps share this Stripe account and send their own billing
 * emails, so Stripe's customer emails stay off for all three (they would
 * double up). StudioCue sent none: a studio was told nothing by email before
 * its trial converted, nothing when its card failed, and nothing when it
 * recovered — only banners, which nobody sees while not signed in.
 *
 * - `billing_trial_ending` — three days before a trial ends (daily scheduler).
 * - `billing_payment_failed` — each failed attempt (Stripe webhook).
 * - `billing_payment_recovered` — the first payment after a failure.
 * - `billing_referral_credit` — a referral's one-off credit was added
 *   (saas/referrals.ts).
 * - `trial_cue_*` — "Cue's first two weeks", days 0, 2 and 7 of the trial
 *   (trial-series.ts), from the same daily scheduler.
 *
 * StudioCue's own letterhead, never the studio's (isPlatformEmailType), and
 * never held when a studio lapses (billing-hold.ts): these are how a lapsed
 * studio finds out. Each is queued once, under an id that names it.
 */

export const BILLING_NOTICE_TYPES = [
  "billing_trial_ending",
  "billing_payment_failed",
  "billing_payment_recovered",
  "billing_referral_credit",
] as const;
export type BillingNoticeType = (typeof BILLING_NOTICE_TYPES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com";

/** Whether this subscription is owed its trial reminder now. Pure. */
export function trialNoticeDue(
  record: { status?: unknown; comped?: unknown; trialEndAt?: unknown; currentPeriodEnd?: unknown; trialEndingNoticeFor?: unknown; suspendedAt?: unknown },
  now: number,
): string | null {
  if (record.comped === true) return null;
  const access = subscriptionAccess(record, now);
  if (access.status !== "trialing" || !access.trialEndsAt) return null;
  const remaining = Date.parse(access.trialEndsAt) - now;
  if (remaining <= 0 || remaining > TRIAL_NOTICE_DAYS * DAY_MS) return null;
  // Once per trial end: a trial extended in the Console gets a fresh reminder.
  return record.trialEndingNoticeFor === access.trialEndsAt ? null : access.trialEndsAt;
}

/** "$150/month", from what Stripe last reported for the subscription. */
export function planPriceText(unitAmountCents: unknown, cadence: unknown, currency = "USD"): string | null {
  const cents = Number(unitAmountCents);
  if (!Number.isSafeInteger(cents) || cents <= 0) return null;
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  return `${amount}/${cadence === "yearly" ? "year" : "month"}`;
}

export function longDateIn(iso: string, timeZone: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone });
  } catch {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
}

/**
 * Who hears about billing: the owner's sign-in address — the person who can
 * change the card — then the studio's own notification address.
 */
export async function billingRecipient(db: Firestore, tenantId: string): Promise<{ email: string; name: string | null } | null> {
  const memberships = await db.collection("memberships").where("tenantId", "==", tenantId).limit(50).get();
  for (const owner of memberships.docs.filter(
    (document) => document.get("role") === "studio_owner" && document.get("status") === "active",
  )) {
    try {
      const user = await getAuth().getUser(String(owner.get("userId") ?? ""));
      if (user.email) return { email: user.email, name: user.displayName ?? null };
    } catch {
      // A membership pointing at a deleted user: try the next owner.
    }
  }
  const fallback = await studioNotificationAddress(db, tenantId);
  return fallback ? { email: fallback, name: null } : null;
}

/** Queue one billing notice. Returns false when it was already queued. */
export async function queueBillingNotice(
  db: Firestore,
  input: {
    tenantId: string;
    type: BillingNoticeType | TrialSeriesType;
    dedupeKey: string;
    values: Record<string, unknown>;
    /** A fixed job id, when the notice names its own (trial-series.ts). */
    id?: string;
  },
): Promise<boolean> {
  const recipient = await billingRecipient(db, input.tenantId);
  if (!recipient) {
    logger.warn("billing_notice_no_recipient", { tenantId: input.tenantId, type: input.type });
    return false;
  }
  const tenant = await db.doc(`tenants/${input.tenantId}`).get();
  const id =
    input.id ?? `${input.type}_${input.tenantId}_${input.dedupeKey}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 400);
  const now = new Date().toISOString();
  try {
    await db.doc(`emailJobs/${id}`).create({
      id,
      tenantId: input.tenantId,
      projectId: null,
      type: input.type,
      recipient: recipient.email,
      recipientName: recipient.name,
      soleRecipient: true,
      studioName: String(tenant.get("brandName") ?? tenant.get("businessName") ?? "") || "your studio",
      actionUrl: `${appUrl()}/studio/subscription`,
      ...input.values,
      status: "queued",
      attempts: 0,
      maxAttempts: 5,
      createdAt: now,
      updatedAt: now,
      createdBy: "billing-notices",
    });
    return true;
  } catch (caught: unknown) {
    // ALREADY_EXISTS (gRPC 6): this notice was queued before.
    if ((caught as { code?: unknown })?.code === 6) return false;
    throw caught;
  }
}

/** The grace end a failed-payment email promises, from when the trouble started. */
export function graceEndsAt(pastDueSince: unknown, now: number): string {
  const since = typeof pastDueSince === "string" && Number.isFinite(Date.parse(pastDueSince)) ? Date.parse(pastDueSince) : now;
  return new Date(since + PAST_DUE_GRACE_DAYS * DAY_MS).toISOString();
}

/**
 * What happened for a studio since its trial started, from its own records.
 * Every query is scoped to the tenant; the emailJobs one rides the existing
 * (tenantId, createdAt) index, the others are single-field equality reads.
 */
export async function readTrialActivity(db: Firestore, tenantId: string, sinceIso: string): Promise<TrialActivity> {
  const [emailJobs, aiActions, leads] = await Promise.all([
    db
      .collection("emailJobs")
      .where("tenantId", "==", tenantId)
      .where("createdAt", ">=", sinceIso)
      .select("type", "status", "result", "createdAt")
      .limit(2000)
      .get(),
    db.collection("aiActions").where("tenantId", "==", tenantId).select("status", "decision", "createdAt", "archivedAt").limit(1000).get(),
    db.collection("leads").where("tenantId", "==", tenantId).select("createdAt", "notInquiry", "archivedAt").limit(1000).get(),
  ]);
  return summarizeTrialActivity(
    {
      emailJobs: emailJobs.docs.map((document) => document.data()),
      aiActions: aiActions.docs.map((document) => document.data()),
      leads: leads.docs.map((document) => document.data()),
    },
    sinceIso,
  );
}

/**
 * Queue the "Cue's first two weeks" email this studio is owed now, if any.
 * Latest only, and once per step: the fixed job id makes a second attempt a
 * no-op, and an earlier step a missed day skipped is never sent afterwards.
 */
export async function queueTrialSeries(
  db: Firestore,
  subscription: { id: string; exists: boolean; get(field: string): unknown },
  now: number,
): Promise<boolean> {
  const due = trialSeriesDue(
    { ...subscriptionAccessRecord(subscription), comped: subscription.get("comped"), currentPeriodStart: subscription.get("currentPeriodStart") },
    now,
  );
  if (!due) return false;
  const tenantId = subscription.id;
  const id = trialSeriesJobId(tenantId, due.step);
  if ((await db.doc(`emailJobs/${id}`).get()).exists) return false;
  let values: Record<string, unknown>;
  if (due.step === "starts") {
    values = { actionUrl: `${appUrl()}/studio/setup` };
  } else if (due.step === "so_far") {
    const activity = await readTrialActivity(db, tenantId, due.trialStartedAt);
    const quiet = trialActivityIsEmpty(activity);
    values = {
      trialActivity: activity,
      trialDays: due.day,
      actionUrl: quiet ? `${appUrl()}/studio/settings/inquiry-capture` : `${appUrl()}/studio`,
    };
  } else {
    values = { trustApprovals: TRUST_DIAL_APPROVALS, actionUrl: `${appUrl()}/studio/settings/automatic-drafts` };
  }
  return queueBillingNotice(db, { tenantId, type: due.type, dedupeKey: due.step, id, values });
}

/** Trial reminders and "Cue's first two weeks", once a day. */
export const billingNoticeScheduler = onSchedule(
  { schedule: "every day 15:00", timeZone: "UTC", retryCount: 1 },
  async () => {
    const db = getFirestore();
    const now = Date.now();
    const trialing = await db.collection("subscriptions").where("status", "==", "trialing").get();
    let queued = 0;
    let series = 0;
    for (const subscription of trialing.docs) {
      // A failure here (a read, a recipient) must not cost a studio its
      // trial-ending notice below.
      try {
        if (await queueTrialSeries(db, subscription, now)) series += 1;
      } catch (caught: unknown) {
        logger.warn("trial_series_failed", { tenantId: subscription.id, error: caught instanceof Error ? caught.message : String(caught) });
      }
      const record = { ...subscriptionAccessRecord(subscription), comped: subscription.get("comped"), trialEndingNoticeFor: subscription.get("trialEndingNoticeFor") };
      const trialEndsAt = trialNoticeDue(record, now);
      if (!trialEndsAt) continue;
      const tenant = await db.doc(`tenants/${subscription.id}`).get();
      const zone = String(tenant.get("timezone") ?? "") || "America/New_York";
      const sent = await queueBillingNotice(db, {
        tenantId: subscription.id,
        type: "billing_trial_ending",
        dedupeKey: trialEndsAt.slice(0, 10),
        values: {
          trialEndText: longDateIn(trialEndsAt, zone),
          planName: subscription.get("plan") === "multi_brand" ? "Multi-Brand" : "Studio",
          priceText: planPriceText(subscription.get("unitAmountCents"), subscription.get("cadence")),
        },
      });
      await subscription.ref.set({ trialEndingNoticeFor: trialEndsAt }, { merge: true });
      if (sent) queued += 1;
    }
    if (queued) logger.info("billing_trial_notices_queued", { queued });
    if (series) logger.info("trial_series_queued", { queued: series });
  },
);
