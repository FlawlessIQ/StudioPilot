import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { entitlements, priceFor, writeSubscriptionFromStripe } from "../../saas/stripe.js";
import { REASON_MIN, consoleHandler, fail } from "../command-kit.js";
import { refreshStudioSummary } from "../rollup.js";
import { MAX_TRIAL_DAYS, STUDIOCUE_METADATA, stripeMock, stripeRequest, unix } from "../stripe-admin.js";
import { confirmsName } from "./studios.js";
import { platformEmailJob, shortToken, studioOwner, teamReplyAddress } from "../studio-owner.js";

/**
 * Subscription control from the Console (docs/console.md, "Billing").
 *
 * Stripe stays the record of anything Stripe bills: these commands change the
 * Stripe subscription and then write what Stripe now says, the same way the
 * webhook does, so the Console never shows a state Stripe doesn't have. Only
 * studios with no Stripe subscription — before the card, or comped — are
 * changed locally, and only on the fields the access gate reads.
 *
 * Card numbers never pass through here. A studio updates its card in Stripe's
 * own portal; the Console can only send them the link to it.
 */

const tenantId = z.string().min(1).max(200);
const reason = z.string().trim().min(REASON_MIN).max(1000);
const plan = z.enum(["studio", "multi_brand"]);
const cadence = z.enum(["monthly", "yearly"]);
type Plan = z.infer<typeof plan>;

const DAY = 86_400_000;

async function loadSubscription(db: Firestore, id: string) {
  const reference = db.doc(`subscriptions/${id}`);
  const snapshot = await reference.get();
  if (!snapshot.exists) fail("SUBSCRIPTION_NOT_FOUND");
  const stripeId = String(snapshot.get("stripeSubscriptionId") ?? "");
  const status = String(snapshot.get("status") ?? "");
  const live = Boolean(stripeId) && ["trialing", "active", "past_due", "unpaid", "paused"].includes(status);
  return { reference, snapshot, stripeId, status, live, comped: snapshot.get("comped") === true };
}

/** Read the Stripe subscription back and write it exactly as the webhook would. */
async function syncFromStripe(db: Firestore, id: string, stripeId: string, now: string) {
  const object = await stripeRequest<Record<string, unknown>>("GET", `subscriptions/${encodeURIComponent(stripeId)}`, { "expand[]": "discount.promotion_code" });
  const reference = db.doc(`subscriptions/${id}`);
  const current = await reference.get();
  const batch = db.batch();
  const outcome = await writeSubscriptionFromStripe(batch, reference, current, id, object, object.status === "canceled", now);
  await batch.commit();
  return outcome;
}

function couponSummary(coupon: Record<string, unknown>, code: string | null, endsAt: string | null) {
  const duration = coupon.duration === "repeating" || coupon.duration === "forever" ? coupon.duration : "once";
  return {
    code,
    couponId: typeof coupon.id === "string" ? coupon.id : null,
    percentOff: typeof coupon.percent_off === "number" ? coupon.percent_off : null,
    amountOffCents: typeof coupon.amount_off === "number" ? coupon.amount_off : null,
    duration,
    durationMonths: typeof coupon.duration_in_months === "number" ? coupon.duration_in_months : null,
    endsAt,
  };
}

export const billingHandlers = {
  /**
   * More trial time. On a Stripe subscription this moves `trial_end` (also how
   * a paying studio is given free time). Before the card is added it sets a
   * trial end the first Checkout honours instead of the standard 14 days.
   */
  extendTrial: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId, until: z.string().datetime(), reason }),
    async run({ db, auth, now }, input) {
      const until = Date.parse(input.until);
      if (until <= Date.now() + 60_000) fail("TRIAL_END_MUST_BE_FUTURE");
      if (until > Date.now() + MAX_TRIAL_DAYS * DAY) fail("TRIAL_END_TOO_FAR");
      const sub = await loadSubscription(db, input.tenantId);
      if (sub.comped) fail("STUDIO_IS_COMPED");
      if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "cancelled") fail("SUBSCRIPTION_NOT_EXTENDABLE");
      const before = sub.snapshot.get("currentPeriodEnd") ?? null;
      if (sub.live) {
        if (!stripeMock())
          await stripeRequest("POST", `subscriptions/${encodeURIComponent(sub.stripeId)}`, {
            trial_end: unix(input.until),
            proration_behavior: "none",
          });
        if (stripeMock()) await sub.reference.set({ status: "trialing", currentPeriodEnd: input.until, updatedAt: now }, { merge: true });
        else await syncFromStripe(db, input.tenantId, sub.stripeId, now);
      } else {
        await sub.reference.set({ trialEndOverride: input.until, currentPeriodEnd: input.until, updatedAt: now }, { merge: true });
      }
      await db.doc(`tenants/${input.tenantId}`).set({ trialEndAt: input.until, updatedAt: now }, { merge: true });
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, trialEndsAt: input.until, viaStripe: sub.live },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, before: { trialEndsAt: before }, after: { trialEndsAt: input.until }, reason: input.reason },
      };
    },
  }),

  /**
   * Comp a studio, optionally until a date. A studio with a live Stripe
   * subscription keeps it, with a 100% coupon, so Stripe still knows; one
   * without is comped here. Ending a comp needs the studio's name typed: it
   * locks a studio out until they add a card.
   */
  setComp: consoleHandler({
    capability: "billing.write",
    input: z.object({
      tenantId,
      comped: z.boolean(),
      until: z.string().datetime().nullable().optional(),
      reason,
      confirmName: z.string().trim().optional(),
    }),
    async run({ db, auth, now }, input) {
      const sub = await loadSubscription(db, input.tenantId);
      const tenant = await db.doc(`tenants/${input.tenantId}`).get();
      if (input.until && Date.parse(input.until) <= Date.now()) fail("COMP_END_MUST_BE_FUTURE");
      if (input.comped) {
        if (sub.comped) fail("ALREADY_COMPED");
        if (sub.live) {
          let couponId = "local-mock-comp";
          if (!stripeMock()) {
            const months = input.until ? Math.max(1, Math.ceil((Date.parse(input.until) - Date.now()) / (30 * DAY))) : null;
            const coupon = await stripeRequest<{ id: string }>("POST", "coupons", {
              percent_off: 100,
              duration: months ? "repeating" : "forever",
              duration_in_months: months ?? undefined,
              name: "StudioCue comp",
              "metadata[app]": STUDIOCUE_METADATA.app,
              "metadata[kind]": "comp",
              "metadata[tenantId]": input.tenantId,
            });
            couponId = coupon.id;
            await stripeRequest("POST", `subscriptions/${encodeURIComponent(sub.stripeId)}`, { "discounts[0][coupon]": couponId });
          }
          await sub.reference.set(
            { comped: true, compMode: "stripe_coupon", compCouponId: couponId, compEndsAt: input.until ?? null, compReason: input.reason, updatedAt: now },
            { merge: true },
          );
        } else {
          await sub.reference.set(
            {
              comped: true,
              compMode: "local",
              compEndsAt: input.until ?? null,
              compReason: input.reason,
              status: "active",
              checkoutRequired: false,
              currentPeriodEnd: input.until ?? null,
              trialEndOverride: null,
              updatedAt: now,
            },
            { merge: true },
          );
        }
      } else {
        if (!sub.comped) fail("NOT_COMPED");
        if (!confirmsName(input.confirmName ?? "", [tenant.get("brandName"), tenant.get("businessName"), tenant.get("legalName")]))
          fail("CONFIRMATION_NAME_MISMATCH");
        if (sub.snapshot.get("compMode") === "stripe_coupon" && sub.stripeId) {
          if (!stripeMock()) await stripeRequest("DELETE", `subscriptions/${encodeURIComponent(sub.stripeId)}/discount`);
          await sub.reference.set({ comped: false, compMode: null, compCouponId: null, compEndsAt: null, discount: null, updatedAt: now }, { merge: true });
        } else {
          // No subscription behind the comp: the studio adds a card to carry on.
          await sub.reference.set(
            { comped: false, compMode: null, compEndsAt: null, status: "incomplete", checkoutRequired: true, currentPeriodEnd: null, updatedAt: now },
            { merge: true },
          );
        }
      }
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, comped: input.comped, until: input.until ?? null },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, before: { comped: sub.comped }, after: { comped: input.comped, until: input.until ?? null }, reason: input.reason },
      };
    },
  }),

  /** Move a studio to another plan or cadence, prorated by Stripe. */
  changePlan: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId, plan, cadence, reason }),
    async run({ db, auth, now }, input) {
      const sub = await loadSubscription(db, input.tenantId);
      const before = { plan: sub.snapshot.get("plan") ?? null, cadence: sub.snapshot.get("cadence") ?? null };
      if (before.plan === input.plan && before.cadence === input.cadence) fail("PLAN_UNCHANGED");
      if (sub.live && !sub.comped) {
        const priceId = priceFor(input.plan as Plan, input.cadence);
        if (!priceId && !stripeMock()) fail("STRIPE_PRICE_NOT_CONFIGURED");
        if (stripeMock()) {
          await sub.reference.set({ plan: input.plan, cadence: input.cadence, entitlements: entitlements[input.plan as Plan], updatedAt: now }, { merge: true });
        } else {
          const current = await stripeRequest<{ items?: { data?: Array<{ id: string }> } }>("GET", `subscriptions/${encodeURIComponent(sub.stripeId)}`);
          const itemId = current.items?.data?.[0]?.id;
          if (!itemId) fail("STRIPE_SUBSCRIPTION_ITEM_MISSING");
          await stripeRequest("POST", `subscriptions/${encodeURIComponent(sub.stripeId)}`, {
            "items[0][id]": itemId,
            "items[0][price]": priceId,
            proration_behavior: "create_prorations",
          });
          await syncFromStripe(db, input.tenantId, sub.stripeId, now);
        }
      } else {
        await sub.reference.set({ plan: input.plan, cadence: input.cadence, entitlements: entitlements[input.plan as Plan], updatedAt: now }, { merge: true });
      }
      await db.doc(`tenants/${input.tenantId}`).set({ subscriptionPlan: input.plan, updatedAt: now }, { merge: true });
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, plan: input.plan, cadence: input.cadence },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, before, after: { plan: input.plan, cadence: input.cadence }, reason: input.reason },
      };
    },
  }),

  /** Cancel at the end of the paid period, or undo that. Never immediate from here. */
  setCancelAtPeriodEnd: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId, cancel: z.boolean(), reason, confirmName: z.string().trim().optional() }),
    async run({ db, auth, now }, input) {
      const sub = await loadSubscription(db, input.tenantId);
      if (!sub.live) fail("NO_STRIPE_SUBSCRIPTION");
      if (input.cancel) {
        const tenant = await db.doc(`tenants/${input.tenantId}`).get();
        if (!confirmsName(input.confirmName ?? "", [tenant.get("brandName"), tenant.get("businessName"), tenant.get("legalName")]))
          fail("CONFIRMATION_NAME_MISMATCH");
      }
      if (stripeMock()) await sub.reference.set({ cancelAtPeriodEnd: input.cancel, updatedAt: now }, { merge: true });
      else {
        await stripeRequest("POST", `subscriptions/${encodeURIComponent(sub.stripeId)}`, { cancel_at_period_end: input.cancel });
        await syncFromStripe(db, input.tenantId, sub.stripeId, now);
      }
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, cancelAtPeriodEnd: input.cancel },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, before: { cancelAtPeriodEnd: sub.snapshot.get("cancelAtPeriodEnd") === true }, after: { cancelAtPeriodEnd: input.cancel }, reason: input.reason },
      };
    },
  }),

  /**
   * Put a discount on one studio. With a Stripe subscription it applies now;
   * before the card it waits and rides into their first Checkout.
   */
  applyDiscount: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId, couponId: z.string().min(1).max(200), reason }),
    async run({ db, auth, now }, input) {
      const sub = await loadSubscription(db, input.tenantId);
      if (sub.comped) fail("STUDIO_IS_COMPED");
      let coupon: Record<string, unknown>;
      if (stripeMock()) {
        // Codes are filed by promotion-code id; find one over this coupon.
        const mirror = (await db.collection("saasDiscounts").where("couponId", "==", input.couponId).limit(1).get()).docs[0];
        if (!mirror) fail("COUPON_NOT_VALID");
        coupon = {
          id: input.couponId,
          percent_off: mirror.get("percentOff") ?? null,
          amount_off: mirror.get("amountOffCents") ?? null,
          duration: mirror.get("duration") ?? "once",
          duration_in_months: mirror.get("durationMonths") ?? null,
        };
      } else {
        coupon = await stripeRequest("GET", `coupons/${encodeURIComponent(input.couponId)}`);
        if ((coupon.metadata as Record<string, string> | undefined)?.app !== STUDIOCUE_METADATA.app) fail("COUPON_NOT_STUDIOCUE");
        if (coupon.valid === false) fail("COUPON_NOT_VALID");
      }
      const months = typeof coupon.duration_in_months === "number" ? coupon.duration_in_months : null;
      const endsAt = coupon.duration === "repeating" && months ? new Date(Date.now() + months * 30 * DAY).toISOString() : null;
      if (sub.live) {
        if (!stripeMock()) {
          await stripeRequest("POST", `subscriptions/${encodeURIComponent(sub.stripeId)}`, { "discounts[0][coupon]": input.couponId });
          await syncFromStripe(db, input.tenantId, sub.stripeId, now);
        } else await sub.reference.set({ discount: couponSummary(coupon, null, endsAt), updatedAt: now }, { merge: true });
      } else {
        await sub.reference.set({ pendingCouponId: input.couponId, discount: couponSummary(coupon, null, null), updatedAt: now }, { merge: true });
      }
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, couponId: input.couponId, pending: !sub.live },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, after: { couponId: input.couponId, pending: !sub.live }, reason: input.reason },
      };
    },
  }),

  removeDiscount: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId, reason }),
    async run({ db, auth, now }, input) {
      const sub = await loadSubscription(db, input.tenantId);
      if (!sub.snapshot.get("discount") && !sub.snapshot.get("pendingCouponId")) fail("NO_DISCOUNT");
      if (sub.snapshot.get("compMode") === "stripe_coupon") fail("STUDIO_IS_COMPED");
      if (sub.live && !stripeMock()) await stripeRequest("DELETE", `subscriptions/${encodeURIComponent(sub.stripeId)}/discount`);
      await sub.reference.set({ discount: null, pendingCouponId: null, updatedAt: now }, { merge: true });
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, removed: true },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, before: { discount: sub.snapshot.get("discount") ?? null }, after: { discount: null }, reason: input.reason },
      };
    },
  }),

  /**
   * Email the owner a link to update their card. The link opens their own
   * subscription page, where Stripe's portal takes the card; StudioCue never
   * sees it.
   */
  sendCardUpdateLink: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId }),
    async run({ db, auth, identity, now }, input) {
      const owner = await studioOwner(db, auth, input.tenantId);
      if (!owner) fail("TENANT_NOT_FOUND");
      if (!owner.email) fail("OWNER_EMAIL_MISSING");
      const jobId = `console_card_${input.tenantId}_${shortToken()}`;
      await db.doc(`emailJobs/${jobId}`).create(
        platformEmailJob(
          jobId,
          {
            type: "platform_message",
            recipient: owner.email,
            recipientName: owner.name,
            replyAddress: teamReplyAddress(),
            customSubject: `Your payment for ${owner.studioName} didn't go through`,
            customBody: [
              `We couldn't take the latest payment for ${owner.studioName}.`,
              "Update your card from your subscription page and we'll try again straight away. It takes a minute, and nothing in your studio changes.",
              "If something's wrong, reply to this email and we'll help.",
            ].join("\n"),
            actionLabel: "Update your card",
            actionUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://studio-cue.com"}/studio/subscription`,
            aboutTenantId: input.tenantId,
            sentByUid: identity.uid,
          },
          now,
        ),
      );
      return {
        result: { tenantId: input.tenantId, sent: true, recipient: owner.email },
        audit: { tenantId: input.tenantId, entityType: "console_email", entityId: jobId, after: { kind: "card_update_link", recipient: owner.email } },
      };
    },
  }),

  /** Read the subscription back from Stripe, for a record that looks wrong. */
  syncSubscription: consoleHandler({
    capability: "billing.write",
    input: z.object({ tenantId }),
    async run({ db, auth, now }, input) {
      const sub = await loadSubscription(db, input.tenantId);
      if (!sub.stripeId) fail("NO_STRIPE_SUBSCRIPTION");
      const outcome = stripeMock() ? { status: sub.status, plan: String(sub.snapshot.get("plan")) } : await syncFromStripe(db, input.tenantId, sub.stripeId, now);
      await refreshStudioSummary(db, auth, input.tenantId);
      return {
        result: { tenantId: input.tenantId, ...outcome, syncedAt: now },
        audit: { tenantId: input.tenantId, entityType: "subscription", entityId: input.tenantId, after: outcome },
      };
    },
  }),
};

/** For the rollup: local comps whose end date has passed go back to "add a card". */
export async function expireLocalComps(db: Firestore, now: string) {
  const comped = await db.collection("subscriptions").where("comped", "==", true).get();
  let expired = 0;
  for (const doc of comped.docs) {
    const ends = doc.get("compEndsAt");
    if (typeof ends !== "string" || Date.parse(ends) > Date.parse(now)) continue;
    if (doc.get("compMode") === "stripe_coupon") {
      // The coupon's own duration ends the discount in Stripe; just drop the flag.
      await doc.ref.set({ comped: false, compMode: null, compEndsAt: null, updatedAt: now }, { merge: true });
    } else {
      await doc.ref.set(
        { comped: false, compMode: null, compEndsAt: null, status: "incomplete", checkoutRequired: true, currentPeriodEnd: null, updatedAt: now },
        { merge: true },
      );
    }
    expired += 1;
  }
  return expired;
}

