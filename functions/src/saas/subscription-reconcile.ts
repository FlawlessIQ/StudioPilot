import { FieldPath, getFirestore, type Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { stripeMock, stripeRequest } from "../console/stripe-admin.js";
import { stripeSubscriptionState, writeSubscriptionFromStripe } from "./stripe.js";

/**
 * A missed Stripe webhook must never lock out a studio that has paid.
 *
 * The subscription record moves only on `customer.subscription.*` events
 * (stripeWebhook). Miss the past_due → active one — a handler error answers
 * 400 and Stripe stops retrying after about three days — and a studio that
 * paid stays past due: read-only once the grace period ends
 * (subscription-access.ts), every studio command refused by
 * requireActiveSubscription. The Console's syncSubscription repaired it by
 * hand; subscriptionReconciler does the same thing for every studio every six
 * hours.
 *
 * Both read the subscription back from Stripe and write it through
 * writeSubscriptionFromStripe, the webhook's own write, so a repair is exactly
 * the update the missed event would have made.
 */

/** The stored fields the reconciler compares with Stripe. */
export type SubscriptionDriftField = "status" | "currentPeriodEnd" | "cancelAtPeriodEnd";

/**
 * Where the stored record disagrees with the Stripe object, mapped as the
 * webhook maps it (stripeSubscriptionState). A period Stripe didn't report is
 * no disagreement: the webhook keeps the stored one in that case too.
 */
export function subscriptionDrift(
  stored: { status?: unknown; currentPeriodEnd?: unknown; cancelAtPeriodEnd?: unknown },
  object: Record<string, unknown>,
): SubscriptionDriftField[] {
  const state = stripeSubscriptionState(object, object.status === "canceled");
  const drift: SubscriptionDriftField[] = [];
  if (String(stored.status ?? "") !== state.status) drift.push("status");
  if (state.currentPeriodEnd !== null && stored.currentPeriodEnd !== state.currentPeriodEnd) drift.push("currentPeriodEnd");
  if ((stored.cancelAtPeriodEnd === true) !== state.cancelAtPeriodEnd) drift.push("cancelAtPeriodEnd");
  return drift;
}

/**
 * Why a stored subscription is not one to reconcile, or null when it is.
 * A studio the team comped locally has no Stripe subscription carrying the
 * comp — Stripe's view of any old subscription id it still holds is not its
 * billing state — so it is left alone. A comp carried by a 100% coupon is a
 * Stripe subscription like any other.
 */
export function reconcileSkipReason(stored: {
  stripeSubscriptionId?: unknown;
  comped?: unknown;
  compMode?: unknown;
}): "no_stripe_subscription" | "local_comp" | null {
  if (typeof stored.stripeSubscriptionId !== "string" || !stored.stripeSubscriptionId) return "no_stripe_subscription";
  if (stored.comped === true && stored.compMode !== "stripe_coupon") return "local_comp";
  return null;
}

/**
 * Read a studio's subscription back from Stripe and write it as the webhook
 * would. `always` is the Console's: someone asked, so it writes. `when_drifted`
 * is the reconciler's: it writes, and audits, only when the stored status,
 * period end or scheduled cancellation differs from Stripe's.
 */
export async function syncSubscriptionFromStripe(
  db: Firestore,
  tenantId: string,
  stripeSubscriptionId: string,
  now: string,
  mode: "always" | "when_drifted" = "always",
): Promise<{ status: string; plan: string; drift: SubscriptionDriftField[]; written: boolean }> {
  const object = await stripeRequest<Record<string, unknown>>("GET", `subscriptions/${encodeURIComponent(stripeSubscriptionId)}`, {
    "expand[]": "discount.promotion_code",
  });
  const reference = db.doc(`subscriptions/${tenantId}`);
  // One transaction, like the webhook's: a webhook landing between the read
  // and the write is seen rather than overwritten with an older comparison.
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const unchanged = { status: String(current.get("status") ?? ""), plan: String(current.get("plan") ?? "") };
    // The studio moved to a new subscription since the read: that one is the record.
    if (current.get("stripeSubscriptionId") !== stripeSubscriptionId) return { ...unchanged, drift: [], written: false };
    const drift = subscriptionDrift(
      { status: current.get("status"), currentPeriodEnd: current.get("currentPeriodEnd"), cancelAtPeriodEnd: current.get("cancelAtPeriodEnd") },
      object,
    );
    if (mode === "when_drifted" && (!drift.length || reconcileSkipReason(current.data() ?? {}))) {
      return { ...unchanged, drift: [], written: false };
    }
    const outcome = await writeSubscriptionFromStripe(transaction, reference, current, tenantId, object, object.status === "canceled", now);
    if (mode === "when_drifted") {
      const id = `subscription_reconcile_${tenantId}_${Date.parse(now)}`;
      transaction.create(db.doc(`auditEvents/${id}`), {
        id,
        tenantId,
        projectId: null,
        actorId: "subscription_reconciler",
        actorType: "system",
        action: "subscription.reconciled",
        entityType: "subscription",
        entityId: tenantId,
        timestamp: now,
        before: { status: unchanged.status, plan: unchanged.plan, currentPeriodEnd: current.get("currentPeriodEnd") ?? null, cancelAtPeriodEnd: current.get("cancelAtPeriodEnd") === true },
        after: { ...outcome, drift },
        ipAddress: null,
        userAgent: null,
        correlationId: stripeSubscriptionId,
        automationRunId: null,
      });
    }
    return { ...outcome, drift, written: true };
  });
}

const PAGE = 200;

/** Every stored subscription, a page at a time, checked against Stripe. */
export async function reconcileSubscriptions(db: Firestore, now: string) {
  let checked = 0;
  let corrected = 0;
  let failed = 0;
  let skipped = 0;
  let after: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection("subscriptions").orderBy(FieldPath.documentId()).limit(PAGE);
    if (after) query = query.startAfter(after);
    const page = await query.get();
    for (const record of page.docs) {
      const stored = record.data();
      if (reconcileSkipReason(stored)) {
        skipped += 1;
        continue;
      }
      const stripeSubscriptionId = String(stored.stripeSubscriptionId);
      checked += 1;
      // One studio's Stripe error is logged and the run goes on.
      try {
        const result = await syncSubscriptionFromStripe(db, record.id, stripeSubscriptionId, now, "when_drifted");
        if (result.written) {
          corrected += 1;
          logger.info("subscriptionReconciled", {
            tenantId: record.id,
            stripeSubscriptionId,
            drift: result.drift,
            before: { status: stored.status ?? null, currentPeriodEnd: stored.currentPeriodEnd ?? null, cancelAtPeriodEnd: stored.cancelAtPeriodEnd === true },
            after: { status: result.status, plan: result.plan },
          });
        }
      } catch (caught) {
        failed += 1;
        logger.error("subscriptionReconcileFailed", {
          studiocueOperationalError: true,
          code: "SUBSCRIPTION_RECONCILE_FAILED",
          tenantId: record.id,
          stripeSubscriptionId,
          error: caught instanceof Error ? caught.message.slice(0, 300) : String(caught),
        });
      }
    }
    if (page.size < PAGE) break;
    after = page.docs[page.docs.length - 1];
  }
  return { checked, corrected, failed, skipped };
}

export const subscriptionReconciler = onSchedule(
  // The same key the Stripe functions mount (stripeWebhook, billingCommand).
  { schedule: "every 6 hours", timeZone: "UTC", retryCount: 0, secrets: ["STRIPE_SECRET_KEY"] },
  async () => {
    // The emulator never calls Stripe (console/stripe-admin.ts).
    if (stripeMock()) return;
    const result = await reconcileSubscriptions(getFirestore(), new Date().toISOString());
    logger.info("subscriptionReconcileRun", result);
  },
);
