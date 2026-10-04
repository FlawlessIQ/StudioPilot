import { getFirestore, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions";
import { isPlatformEmailType } from "../communications/email-templates.js";
import { clientAutomationEmailTypes } from "../imports/existing-booking.js";
import { HELD_INVOICE_JOB_TYPE } from "../operations/quickbooks-held-invoice.js";
import { subscriptionAccessRecord } from "./entitlement-guard.js";
import { accessAllowsWork, subscriptionAccess, type SubscriptionAccess } from "./subscription-access.js";

/**
 * Nothing goes out on a lapsed studio's behalf — and nothing is lost.
 *
 * Every studio command already stops when a studio is read-only, but the
 * automations do not run through commands. The week-of reminder, the
 * questionnaire nudge, the final invoice, the autopay charge: schedulers
 * queue them and the job workers send them, and none of that asked whether
 * the studio was still paying. A studio whose card had failed for a month
 * would keep emailing and charging its clients.
 *
 * So the workers ask, as each job comes due. A job for a studio that is
 * read-only or closed (subscription-access.ts) is parked as `held_billing`
 * instead of sent. When the studio can work again — payment goes through, the
 * team comps it, a suspension is lifted — the subscription trigger below puts
 * every parked job back in the queue, and each job's own checks (is the
 * contract still unsigned, is the invoice still open, has the date moved)
 * run as it goes, exactly as they would have. Automated reminders that sat
 * parked for more than {@link STALE_REMINDER_DAYS} days are retired rather
 * than sent late.
 *
 * Not held: StudioCue's own mail (sign-in links, feedback, the team), mail
 * to the studio itself (a new inquiry, a signed contract, a client's
 * message — the studio should still know), and the copy a client receives
 * of something they just did themselves (their signed agreement, the
 * acknowledgement of their inquiry). Bookkeeping that records what already
 * happened — a payment, a void, a calendar move — is not held either.
 */

export const BILLING_HOLD_STATUS = "held_billing";

/** Reminders parked longer than this are retired on release, not sent late. */
export const STALE_REMINDER_DAYS = 14;

/** Mail to the studio itself, or a client's copy of their own act. */
const DELIVERED_WHILE_LAPSED: readonly string[] = [
  "studio_contract_signed",
  "client_message_received",
  "studio_booking_confirmed",
  "studio_capture_silent",
  "studio_new_inquiry",
  "studio_schedule_changes_requested",
  "daily_digest",
  "contract_signed",
  "inquiry_acknowledgement",
];

/** Provider work that sends a bill or takes money on the studio's behalf. */
const HELD_PROVIDER_TYPES: readonly string[] = [
  "create_quickbooks_invoice",
  "create_stripe_invoice",
  HELD_INVOICE_JOB_TYPE,
  "charge_saved_card",
];

/** Automated nudges whose moment passes; retired if they sat parked too long. */
const PERISHABLE_EMAIL_TYPES: readonly string[] = [
  ...clientAutomationEmailTypes.filter(
    (type) => !["retainer_invoice", "final_invoice", "booking_confirmation"].includes(type),
  ),
  "consultation_reminder",
  "crew_reminder",
  "album_selection_reminder",
  "review_request",
];

export function billingHoldApplies(collection: string, type: string): boolean {
  if (collection === "emailJobs") {
    return !isPlatformEmailType(type) && !DELIVERED_WHILE_LAPSED.includes(type);
  }
  if (collection === "providerJobs") return HELD_PROVIDER_TYPES.includes(type);
  return false;
}

const ACCESS_CACHE_MS = 60_000;
const accessCache = new Map<string, { at: number; access: SubscriptionAccess }>();

async function tenantAccess(db: Firestore, tenantId: string): Promise<SubscriptionAccess> {
  const cached = accessCache.get(tenantId);
  if (cached && Date.now() - cached.at < ACCESS_CACHE_MS) return cached.access;
  const access = subscriptionAccess(
    subscriptionAccessRecord(await db.doc(`subscriptions/${tenantId}`).get()),
  );
  accessCache.set(tenantId, { at: Date.now(), access });
  return access;
}

/** Why this job must wait for billing, or null when it may go. */
export async function billingHoldFor(
  db: Firestore,
  collection: string,
  document: DocumentSnapshot,
): Promise<string | null> {
  const tenantId = String(document.get("tenantId") ?? "");
  const type = String(document.get("type") ?? "");
  if (!tenantId || !billingHoldApplies(collection, type)) return null;
  const access = await tenantAccess(db, tenantId);
  return accessAllowsWork(access) ? null : `subscription_${access.level}`;
}

/**
 * Park a due job. Read and written in one transaction, so a job another
 * worker has already claimed is left alone.
 */
export async function holdJobForBilling(
  document: DocumentSnapshot,
  reason: string,
): Promise<boolean> {
  return getFirestore().runTransaction(async (transaction) => {
    const current = await transaction.get(document.ref);
    const status = String(current.get("status") ?? "");
    if (!current.exists || !["queued", "retry_scheduled"].includes(status)) return false;
    const now = new Date().toISOString();
    transaction.update(document.ref, {
      status: BILLING_HOLD_STATUS,
      billingHold: { reason, heldAt: now, fromStatus: status },
      updatedAt: now,
    });
    return true;
  });
}

/** What release does with one parked job. Pure. */
export function releaseDecision(
  collection: string,
  job: { type?: unknown; billingHold?: unknown },
  now: number,
): "queue" | "retire" {
  const type = String(job.type ?? "");
  const heldAt = Date.parse(String((job.billingHold as { heldAt?: unknown } | undefined)?.heldAt ?? ""));
  const stale =
    Number.isFinite(heldAt) && now - heldAt > STALE_REMINDER_DAYS * 24 * 60 * 60 * 1000;
  return collection === "emailJobs" && stale && PERISHABLE_EMAIL_TYPES.includes(type)
    ? "retire"
    : "queue";
}

/** Put a studio's parked jobs back in the queue. */
export async function releaseBillingHolds(
  db: Firestore,
  tenantId: string,
): Promise<{ queued: number; retired: number }> {
  accessCache.delete(tenantId);
  let queued = 0;
  let retired = 0;
  const now = new Date();
  for (const collection of ["emailJobs", "providerJobs"]) {
    const parked = await db
      .collection(collection)
      .where("tenantId", "==", tenantId)
      .where("status", "==", BILLING_HOLD_STATUS)
      .get();
    for (let start = 0; start < parked.docs.length; start += 400) {
      const batch = db.batch();
      for (const job of parked.docs.slice(start, start + 400)) {
        const decision = releaseDecision(collection, job.data(), now.getTime());
        if (decision === "retire") retired += 1;
        else queued += 1;
        batch.update(
          job.ref,
          decision === "retire"
            ? {
                status: "succeeded",
                result: { held: "stale_after_billing_hold", type: job.get("type") ?? null },
                completedAt: now.toISOString(),
                updatedAt: now.toISOString(),
              }
            : {
                status: "queued",
                nextAttemptAt: null,
                "billingHold.releasedAt": now.toISOString(),
                updatedAt: now.toISOString(),
              },
        );
      }
      await batch.commit();
    }
  }
  return { queued, retired };
}

/**
 * The subscription changed. If the studio could not work before and can now,
 * release what was parked. Every path that restores a studio — Stripe, the
 * return from Checkout, the Console's comp, trial extension and unsuspend —
 * writes this document, so one trigger covers them all.
 */
export const subscriptionAccessChanged = onDocumentWritten(
  { document: "subscriptions/{tenantId}", retry: true },
  async (event) => {
    const before = event.data?.before;
    const after = event.data?.after;
    if (!after?.exists) return;
    const wasWorking = before?.exists
      ? accessAllowsWork(subscriptionAccess(subscriptionAccessRecord(before)))
      : false;
    const isWorking = accessAllowsWork(subscriptionAccess(subscriptionAccessRecord(after)));
    if (wasWorking || !isWorking) return;
    const result = await releaseBillingHolds(getFirestore(), event.params.tenantId);
    if (result.queued || result.retired) {
      logger.info("billing_holds_released", { tenantId: event.params.tenantId, ...result });
    }
  },
);
