import { tradeProfile } from "../trades/trades.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import {
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type WriteBatch,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { commandTypeOf, respondToCommandError } from "../security/command-errors.js";
import { studioHubCors } from "../security/cors.js";
import {
  buildStripeCheckoutParams,
  normalizePromotionCode,
  promotionCouponReference,
  resolvePromotion,
  resolveSubscriptionPeriod,
  type ResolvedPromotion,
} from "./stripe-checkout.js";
import { STRIPE_ADMIN_API_VERSION, fromUnix } from "../console/stripe-admin.js";
import { staleStripeEvent } from "./stripe-event-order.js";
import { graceEndsAt, longDateIn, queueBillingNotice } from "./billing-notices.js";
import {
  creditReferral,
  emailHash,
  ensureReferralCode,
  lookupReferral,
  recordReferral,
  referralCoupon,
  updateReferralStatus,
} from "./referrals.js";
import { OFFER_SUMMARY, REFERRAL_CREDIT_CENTS, creditDueAt } from "./referral-program.js";
import { appUrl } from "../console/studio-owner.js";

const billingCommandSchema = z.object({
  type: z.enum([
    "createCheckout",
    "createPortal",
    "confirmCheckout",
    // The studio's referral code, what it has earned, and whether the vendors
    // on its jobs are invited (saas/referrals.ts, saas/vendor-invites.ts).
    "referralStatus",
    "setVendorInvites",
    // What a code carried from a signup link is, before Checkout.
    "previewCode",
  ]),
  tenantId: z.string(),
  /** setVendorInvites. */
  enabled: z.boolean().optional(),
  /** confirmCheckout: the Checkout Session Stripe returned to (session_id). */
  sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200).optional(),
  plan: z.enum(["studio", "multi_brand", "vendor"]).optional(),
  cadence: z.enum(["monthly", "yearly"]).optional(),
  /**
   * createCheckout: a code carried from the signup link
   * (`/auth/register?code=BETA`). Optional and never trusted for anything but
   * a lookup: a studio's referral code is looked up here (saas/referrals.ts),
   * anything else in Stripe, which decides whether it is valid and its worth.
   */
  promotionCode: z.string().max(64).optional(),
});

/**
 * Look a customer-facing code up in Stripe and resolve it for Checkout.
 *
 * Any failure (unknown code, revoked, expired, network) resolves to null, and
 * the session then falls back to Checkout's own promotion-code field — a bad
 * link must never block a studio from starting its trial.
 */
async function lookupPromotion(
  secret: string,
  rawCode: string | undefined,
): Promise<ResolvedPromotion | null> {
  const code = normalizePromotionCode(rawCode);
  if (!code) return null;
  try {
    const headers = { authorization: `Bearer ${secret}` };
    const listResponse = await fetch(
      `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(code)}&active=true&limit=1`,
      { headers },
    );
    if (!listResponse.ok) return null;
    const list = (await listResponse.json()) as { data?: unknown[] };
    const promotionCode = list.data?.[0];
    if (!promotionCode || typeof promotionCode !== "object") return null;
    let coupon = promotionCouponReference(
      promotionCode as Record<string, unknown>,
    );
    if (typeof coupon === "string") {
      const couponResponse = await fetch(
        `https://api.stripe.com/v1/coupons/${encodeURIComponent(coupon)}`,
        { headers },
      );
      if (!couponResponse.ok) return null;
      coupon = (await couponResponse.json()) as Record<string, unknown>;
    }
    return resolvePromotion(promotionCode, coupon);
  } catch {
    return null;
  }
}
const stripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.number(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
export const entitlements = {
  studio: {
    maxInternalUsers: 3,
    maxBrands: 1,
    maxActiveSubcontractors: 25,
    aiActionsMonthly: 2500,
    smsEnabled: true,
    coiEnabled: true,
    customWorkflowsEnabled: true,
    advancedReportingEnabled: true,
    apiAccessEnabled: false,
    prioritySupportEnabled: true,
  },
  // DJs, makeup artists and hair stylists, $75 a month (config/saas-plans.ts).
  vendor: {
    maxInternalUsers: 2,
    maxBrands: 1,
    maxActiveSubcontractors: 10,
    aiActionsMonthly: 1000,
    smsEnabled: true,
    coiEnabled: true,
    customWorkflowsEnabled: true,
    advancedReportingEnabled: false,
    apiAccessEnabled: false,
    prioritySupportEnabled: false,
  },
  multi_brand: {
    maxInternalUsers: 15,
    maxBrands: 3,
    maxActiveSubcontractors: 100,
    aiActionsMonthly: 7500,
    smsEnabled: true,
    coiEnabled: true,
    customWorkflowsEnabled: true,
    advancedReportingEnabled: true,
    apiAccessEnabled: true,
    prioritySupportEnabled: true,
  },
} as const;
export const priceFor = (
  plan: keyof typeof entitlements,
  cadence: "monthly" | "yearly",
) => process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${cadence.toUpperCase()}`];
const planForPrice = (priceId: string) =>
  Object.keys(entitlements).find((plan) =>
    ["monthly", "yearly"].some(
      (cadence) =>
        priceFor(
          plan as keyof typeof entitlements,
          cadence as "monthly" | "yearly",
        ) === priceId,
    ),
  ) as keyof typeof entitlements | undefined;
const cadenceForPrice = (priceId: string): "monthly" | "yearly" =>
  Object.keys(entitlements).some(
    (plan) => priceFor(plan as keyof typeof entitlements, "yearly") === priceId,
  )
    ? "yearly"
    : "monthly";
/**
 * Stripe's subscription status, as stored. `unpaid` (retries exhausted, if
 * the account is set to mark rather than cancel) and `incomplete_expired`
 * (a first payment never completed) used to fall through to `incomplete` —
 * the state a studio is in before its first Checkout — so a studio that had
 * failed to pay was offered a fresh 14-day trial. `unpaid` is now its own
 * read-only state; `incomplete_expired` is a cancellation.
 */
export const normalizeStatus = (
  value: unknown,
):
  | "trialing"
  | "active"
  | "past_due"
  | "unpaid"
  | "paused"
  | "cancelled"
  | "incomplete" =>
  value === "trialing" ||
  value === "active" ||
  value === "past_due" ||
  value === "unpaid" ||
  value === "paused" ||
  value === "incomplete"
    ? value
    : value === "canceled" || value === "cancelled" || value === "incomplete_expired"
      ? "cancelled"
      : "incomplete";
export const signatureValid = (raw: string, header: string, secret: string) => {
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=", 2)),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - timestamp) > 300)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * The referral a first checkout carries, when the code is another studio's.
 * Never the studio's own, and never one whose owner also owns the referring
 * studio. `via` says whether it came from a vendor invite (vendor-invites.ts).
 */
async function referredBy(
  db: FirebaseFirestore.Firestore,
  rawCode: string | undefined,
  tenantId: string,
  uid: string,
): Promise<{ code: string; referrerTenantId: string; via: string } | null> {
  const referral = await lookupReferral(db, rawCode).catch(() => null);
  if (!referral || referral.referrerTenantId === tenantId) return null;
  const ownsReferrer = await db.doc(`memberships/${referral.referrerTenantId}_${uid}`).get();
  if (ownsReferrer.exists && ownsReferrer.get("role") === "studio_owner") return null;
  const user = await getAuth().getUser(uid).catch(() => null);
  const invite = user?.email ? await db.doc(`vendorInvites/${emailHash(user.email)}`).get() : null;
  const viaInvite = Boolean(invite?.exists && invite.get("code") === referral.code);
  if (invite?.exists && viaInvite) {
    await invite.ref.update({ signedUpTenantId: tenantId, signedUpAt: new Date().toISOString() }).catch(() => undefined);
  }
  return { code: referral.code, referrerTenantId: referral.referrerTenantId, via: viaInvite ? "vendor_invite" : "code" };
}

/** What a studio's Subscription page shows about its referrals. */
async function referralStatus(db: FirebaseFirestore.Firestore, tenantId: string) {
  const code = await ensureReferralCode(db, tenantId);
  const [referrals, tenant, invited] = await Promise.all([
    db.collection("saasReferrals").where("referrerTenantId", "==", tenantId).limit(500).get(),
    db.doc(`tenants/${tenantId}`).get(),
    db.collection("vendorInvites").where("tenantId", "==", tenantId).count().get(),
  ]);
  // Counts and dates, never which studios: a referred studio's choice to use
  // StudioCue is its own business (Privacy Policy, "Sales and referrals").
  const rows = referrals.docs
    .map((referral) => {
      const status = String(referral.get("status") ?? "");
      const paidAt = referral.get("paidAt") as string | undefined;
      return {
        signedUpAt: (referral.get("signedUpAt") as string | undefined) ?? null,
        creditDueAt: paidAt && !referral.get("creditedAt") ? creditDueAt(paidAt) : null,
        via: (referral.get("via") as string | undefined) ?? "code",
        state: referral.get("creditedAt")
          ? "credited"
          : referral.get("forfeitedAt") || ["cancelled", "canceled"].includes(status)
            ? "canceled"
            : referral.get("paidAt")
              ? "paying"
              : "trial",
      };
    })
    .sort((a, b) => String(b.signedUpAt).localeCompare(String(a.signedUpAt)));
  return {
    code,
    link: appUrl(`/auth/register?code=${encodeURIComponent(code)}`),
    offer: OFFER_SUMMARY,
    creditCents: REFERRAL_CREDIT_CENTS,
    referrals: rows,
    creditedCents: rows.filter((row) => row.state === "credited").length * REFERRAL_CREDIT_CENTS,
    pendingCents: rows.filter((row) => row.state === "paying").length * REFERRAL_CREDIT_CENTS,
    vendorInvites: { enabled: tenant.get("vendorInvitesEnabled") !== false, sent: invited.data().count },
  };
}

export const billingCommand = onRequest(
  {
    cors: studioHubCors,
    invoker: "private",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).json({ error: "METHOD_NOT_ALLOWED" });
      return;
    }
    try {
      await requireAppCheck(request);
      const identity = await requireIdentity(request);
      const parsed = billingCommandSchema.parse(request.body);
      const db = getFirestore();
      const membership = await db
        .doc(`memberships/${parsed.tenantId}_${identity.uid}`)
        .get();
      if (
        !membership.exists ||
        membership.get("status") !== "active" ||
        membership.get("role") !== "studio_owner"
      )
        throw new Error("FORBIDDEN");
      if (parsed.type === "referralStatus") {
        response.status(200).json(await referralStatus(db, parsed.tenantId));
        return;
      }
      if (parsed.type === "setVendorInvites") {
        if (typeof parsed.enabled !== "boolean") throw new Error("ENABLED_REQUIRED");
        await db.doc(`tenants/${parsed.tenantId}`).update({ vendorInvitesEnabled: parsed.enabled, updatedAt: new Date().toISOString() });
        response.status(200).json({ enabled: parsed.enabled });
        return;
      }
      if (parsed.type === "previewCode") {
        const referral = await lookupReferral(db, parsed.promotionCode);
        response.status(200).json(
          referral
            ? referral.referrerTenantId === parsed.tenantId
              ? { kind: "own" }
              : { kind: "referral", referrerName: referral.referrerName, offer: OFFER_SUMMARY }
            : { kind: parsed.promotionCode ? "code" : null },
        );
        return;
      }
      if (process.env.BILLING_MOCK_MODE === "true") {
        response
          .status(200)
          .json({
            mode: "mock",
            url: `${process.env.NEXT_PUBLIC_APP_URL}/studio/subscription?preview=success`,
          });
        return;
      }
      const secret = process.env.STRIPE_SECRET_KEY;
      if (!secret) throw new Error("STRIPE_NOT_CONFIGURED");
      if (parsed.type === "confirmCheckout") {
        // The studio is back from Checkout; if the webhook hasn't landed, the
        // Session says what happened. Only a completed session for this studio
        // counts, and it's written exactly as the webhook would write it.
        if (!parsed.sessionId) throw new Error("SESSION_REQUIRED");
        const sessionResponse = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(parsed.sessionId)}?expand[]=subscription`,
          { headers: { authorization: `Bearer ${secret}` } },
        );
        const session = (await sessionResponse.json()) as {
          status?: string;
          metadata?: Record<string, unknown>;
          subscription?: Record<string, unknown> | string | null;
          error?: { message?: string };
        };
        if (!sessionResponse.ok) throw new Error(session.error?.message ?? "STRIPE_REQUEST_FAILED");
        const sessionSubscription =
          session.subscription && typeof session.subscription === "object" ? session.subscription : null;
        const sessionTenant = String(
          session.metadata?.tenantId ??
            (sessionSubscription?.metadata as Record<string, unknown> | undefined)?.tenantId ??
            "",
        );
        if (sessionTenant !== parsed.tenantId) throw new Error("FORBIDDEN");
        if (session.status !== "complete" || !sessionSubscription) {
          response.status(200).json({ confirmed: false, status: session.status ?? null });
          return;
        }
        const subscriptionReference = db.doc(`subscriptions/${parsed.tenantId}`);
        const current = await subscriptionReference.get();
        const now = new Date().toISOString();
        const batch = db.batch();
        const { status, plan } = await writeSubscriptionFromStripe(
          batch,
          subscriptionReference,
          current,
          parsed.tenantId,
          sessionSubscription,
          false,
          now,
        );
        batch.set(
          db.doc(`auditEvents/stripe_return_${parsed.sessionId}`),
          {
            id: `stripe_return_${parsed.sessionId}`,
            tenantId: parsed.tenantId,
            projectId: null,
            actorId: identity.uid,
            actorType: "user",
            action: "subscription.confirmed_on_return",
            entityType: "subscription",
            entityId: parsed.tenantId,
            timestamp: now,
            before: current.exists ? { status: current.get("status"), plan: current.get("plan") } : null,
            after: { status, plan },
            ipAddress: request.ip ?? null,
            userAgent: request.header("user-agent") ?? null,
            correlationId: parsed.sessionId,
            automationRunId: null,
            providerEventId: null,
          },
          { merge: true },
        );
        await batch.commit();
        response.status(200).json({ confirmed: true, status, plan });
        return;
      }
      const subscription = await db
        .doc(`subscriptions/${parsed.tenantId}`)
        .get();
      const customerId = subscription.get("stripeCustomerId") as
        | string
        | undefined;
      const subscriptionId = subscription.get("stripeSubscriptionId") as
        | string
        | undefined;
      const existingStatus = subscription.get("status");
      const hasManagedSubscription =
        Boolean(customerId && subscriptionId) &&
        ["trialing", "active", "past_due", "unpaid", "paused"].includes(
          String(existingStatus),
        );
      const operation =
        parsed.type === "createCheckout" && hasManagedSubscription
          ? "createPortal"
          : parsed.type;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
      let params: URLSearchParams;
      if (operation === "createCheckout") {
        if (!parsed.plan || !parsed.cadence) throw new Error("PLAN_REQUIRED");
        // A studio buys its own trade's plans: a DJ isn't sold the
        // photographer's Studio plan, nor a photographer the vendor one.
        const tenantForPlan = await db.doc(`tenants/${parsed.tenantId}`).get();
        if (!tradeProfile(tenantForPlan.get("trade")).plans.includes(parsed.plan)) throw new Error("PLAN_NOT_FOR_TRADE");
        const comped = subscription.get("comped") === true;
        const override = subscription.get("trialEndOverride") as string | undefined;
        const overrideLive = Boolean(override && Date.parse(override) > Date.now() + 60_000);
        // First checkout (never subscribed) starts a fresh 14-day trial
        // anchored at checkout; see buildStripeCheckoutParams. Only a studio
        // that has never had a Stripe subscription qualifies: status alone
        // was not enough, because records written before `unpaid` and
        // `incomplete_expired` were mapped say `incomplete` too, and those
        // studios have had their trial. A returning studio is charged from
        // checkout (its stored period end is in the past).
        const firstCheckout =
          !comped &&
          !overrideLive &&
          normalizeStatus(existingStatus) === "incomplete" &&
          !subscriptionId;
        // Another studio's referral code: the Studio plan's first year at the
        // referral price, on a studio's first checkout only, never its own.
        const referral =
          firstCheckout && parsed.plan === "studio"
            ? await referredBy(db, parsed.promotionCode, parsed.tenantId, identity.uid)
            : null;
        // Beta codes: a code from the signup link is applied up front; with
        // none (or one Stripe won't honour) Checkout offers its own field.
        const promotion = referral ? null : await lookupPromotion(secret, parsed.promotionCode);
        const priceId = priceFor(parsed.plan, parsed.cadence);
        if (!priceId) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
        // A comped studio choosing to pay starts paying now: its stored
        // period end is the comp's (once 2099), which Stripe refuses as a
        // trial end, and it has had the product already. A trial extended in
        // the Console before the card was added is honoured instead of the
        // fresh 14 days (docs/console.md, "Billing").
        params = buildStripeCheckoutParams({
          appUrl,
          customerId,
          // P11: prefill the owner's verified email when there is no Stripe
          // customer yet, so Checkout isn't asking them to retype it.
          customerEmail: customerId ? null : (identity.email ?? null),
          priceId,
          tenantId: parsed.tenantId,
          // P10: carry the tenant's existing trial end so a RE-checkout honours
          // it rather than restarting the clock.
          trialEndIso: comped
            ? null
            : overrideLive
              ? (override ?? null)
              : ((subscription.get("currentPeriodEnd") as string | undefined) ??
                (subscription.get("trialEndAt") as string | undefined) ??
                null),
          firstCheckout,
          promotion,
        });
        if (referral) {
          params.delete("allow_promotion_codes");
          params.set("discounts[0][coupon]", await referralCoupon(db, parsed.cadence));
          // Carried on the subscription, so the webhook ties the studio to its
          // referrer only once Checkout has actually completed.
          params.set("subscription_data[metadata][referralCode]", referral.code);
          params.set("subscription_data[metadata][referrerTenantId]", referral.referrerTenantId);
          params.set("subscription_data[metadata][referralVia]", referral.via);
        }
        // A discount the team applied in the Console before the card was
        // added rides into this Checkout instead. Stripe takes one discount
        // and refuses it alongside the promotion-code field.
        const pendingCoupon = subscription.get("pendingCouponId") as string | undefined;
        if (pendingCoupon) {
          params.delete("allow_promotion_codes");
          params.delete("discounts[0][promotion_code]");
          params.set("discounts[0][coupon]", pendingCoupon);
        }
      } else {
        params = new URLSearchParams();
        if (!customerId) throw new Error("STRIPE_CUSTOMER_NOT_FOUND");
        params.set("customer", customerId);
        params.set("return_url", `${appUrl}/studio/subscription`);
        const portalConfigurationId =
          process.env.STRIPE_PORTAL_CONFIGURATION_ID;
        if (portalConfigurationId)
          params.set("configuration", portalConfigurationId);
      }
      const endpoint =
        operation === "createCheckout"
          ? "checkout/sessions"
          : "billing_portal/sessions";
      const stripeResponse = await fetch(
        `https://api.stripe.com/v1/${endpoint}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: params,
        },
      );
      const payload = (await stripeResponse.json()) as {
        url?: string;
        error?: { message?: string };
      };
      if (!stripeResponse.ok || !payload.url)
        throw new Error(payload.error?.message ?? "STRIPE_REQUEST_FAILED");
      response.status(200).json({ url: payload.url });
    } catch (caught: unknown) {
      respondToCommandError(response, caught, {
        name: "billingCommand",
        commandType: commandTypeOf(request.body),
        status: (message) => (message === "FORBIDDEN" ? 403 : 400),
      });
    }
  },
);

export const stripeWebhook = onRequest(
  {
    cors: false,
    invoker: "private",
    // The secret key reads the discount and promotion code behind a
    // subscription change, which the event itself may carry only as ids.
    secrets: ["STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"],
  },
  async (request, response) => {
    if (request.method !== "POST") {
      response.status(405).send("METHOD_NOT_ALLOWED");
      return;
    }
    try {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      const header = request.header("stripe-signature");
      const raw = request.rawBody.toString("utf8");
      if (!secret || !header || !signatureValid(raw, header, secret)) {
        response.status(401).send("INVALID_SIGNATURE");
        return;
      }
      const event = stripeEventSchema.parse(JSON.parse(raw));
      const db = getFirestore();
      const eventReference = db.doc(`webhookEvents/stripe_${event.id}`);
      if ((await eventReference.get()).exists) {
        response.status(200).json({ received: true, duplicate: true });
        return;
      }
      const object = event.data.object;
      const now = new Date().toISOString();
      // Invoices, for the Console's Revenue page and a studio's health.
      if (event.type === "invoice.paid" || event.type === "invoice.payment_failed" || event.type === "invoice.finalized") {
        const invoiceTenant = await tenantForInvoice(db, object);
        // The owner hears about it (saas/billing-notices.ts). Queued before the
        // batch, under an id per invoice and attempt, so a webhook retry after
        // a failed commit finds it already queued rather than sending twice.
        if (invoiceTenant && (event.type === "invoice.payment_failed" || event.type === "invoice.paid")) {
          await queueInvoiceNotice(db, invoiceTenant, object, event.type);
        }
        const batch = db.batch();
        if (invoiceTenant) recordInvoice(batch, db, invoiceTenant, object, event.type, now);
        batch.create(eventReference, {
          id: `stripe_${event.id}`,
          tenantId: invoiceTenant,
          provider: "stripe",
          providerEventId: event.id,
          type: event.type,
          status: invoiceTenant ? "processed" : "ignored",
          createdAt: now,
        });
        await batch.commit();
        // A referred studio's first paid invoice counts for its referrer.
        if (invoiceTenant && event.type === "invoice.paid") {
          await creditReferral(db, {
            tenantId: invoiceTenant,
            amountPaidCents: Number(object.amount_paid ?? 0),
            invoiceId: typeof object.id === "string" ? object.id : null,
            now,
          }).catch((caught: unknown) => {
            console.error(JSON.stringify({ severity: "ERROR", event: "referral.credit_failed", tenantId: invoiceTenant, reason: caught instanceof Error ? caught.message : String(caught) }));
          });
        }
        response.status(200).json({ received: true });
        return;
      }
      const metadata = object.metadata as Record<string, unknown> | undefined;
      const tenantId = String(metadata?.tenantId ?? "");
      const supported = [
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
      ].includes(event.type);
      if (!tenantId || !supported) {
        await eventReference.create({
          id: `stripe_${event.id}`,
          tenantId: tenantId || null,
          provider: "stripe",
          providerEventId: event.id,
          type: event.type,
          status: "ignored",
          createdAt: now,
        });
        response.status(200).json({ received: true, ignored: true });
        return;
      }
      const subscriptionReference = db.doc(`subscriptions/${tenantId}`);
      const deleted = event.type === "customer.subscription.deleted";
      // One transaction: the duplicate check, the ordering check and the
      // write all see the same record, so two deliveries racing each other
      // can't both apply.
      const outcome = await db.runTransaction(async (transaction) => {
        if ((await transaction.get(eventReference)).exists) return "duplicate" as const;
        const current = await transaction.get(subscriptionReference);
        const stale = staleStripeEvent({
          lastAppliedCreated: current.get("lastStripeEventCreated"),
          eventCreated: event.created,
          storedStatus: current.get("status"),
          storedSubscriptionId: current.get("stripeSubscriptionId"),
          eventSubscriptionId: object.id,
          eventStatus: object.status,
          deleted,
        });
        if (stale) {
          transaction.create(eventReference, {
            id: `stripe_${event.id}`,
            tenantId,
            provider: "stripe",
            providerEventId: event.id,
            type: event.type,
            status: "stale",
            staleReason: stale,
            createdAt: now,
          });
          return "stale" as const;
        }
        const { status, plan } = await writeSubscriptionFromStripe(
          transaction,
          subscriptionReference,
          current,
          tenantId,
          object,
          deleted,
          now,
          event.created,
        );
        transaction.create(eventReference, {
          id: `stripe_${event.id}`,
          tenantId,
          provider: "stripe",
          providerEventId: event.id,
          type: event.type,
          status: "processed",
          createdAt: now,
        });
        transaction.create(db.doc(`auditEvents/stripe_${event.id}`), {
          id: `stripe_${event.id}`,
          tenantId,
          projectId: null,
          actorId: "stripe",
          actorType: "provider",
          action: "subscription.changed",
          entityType: "subscription",
          entityId: tenantId,
          timestamp: now,
          before: current.exists
            ? { status: current.get("status"), plan: current.get("plan") }
            : null,
          after: { status, plan },
          ipAddress: null,
          userAgent: null,
          correlationId: event.id,
          automationRunId: null,
          providerEventId: event.id,
        });
        return "processed" as const;
      });
      if (outcome !== "processed") {
        response.status(200).json({ received: true, [outcome]: true });
        return;
      }
      response.status(200).json({ received: true });
    } catch {
      response.status(400).send("WEBHOOK_PROCESSING_FAILED");
    }
  },
);

/**
 * A batch or a transaction: the webhook writes inside a transaction so its
 * ordering check and its write see the same record; confirmCheckout batches.
 */
type SubscriptionWriter = {
  set(
    reference: DocumentReference,
    data: Record<string, unknown>,
    options: { merge: true },
  ): unknown;
};

/**
 * The subscription as Stripe reports it, written onto ours.
 *
 * Shared by the webhook and by confirmCheckout, which provisions from the
 * Checkout Session a studio returns with, so a late or failed webhook no longer
 * leaves a paid-up studio on "Starting your trial…" (docs/onboarding-
 * assessment-2026-09-26.md). The same object gives the same record whichever
 * arrives first, and a merge makes the second harmless.
 */
export async function writeSubscriptionFromStripe(
  batch: SubscriptionWriter,
  subscriptionReference: DocumentReference,
  current: DocumentSnapshot,
  tenantId: string,
  object: Record<string, unknown>,
  deleted: boolean,
  now: string,
  /** The webhook event's `created`, so a later, older event can be refused. */
  eventCreated?: number,
): Promise<{ status: string; plan: string }> {
  const items = object.items as
    | {
        data?: Array<{
          price?: { id?: string; unit_amount?: number | null };
          current_period_start?: number;
          current_period_end?: number;
        }>;
      }
    | undefined;
  const firstItem = items?.data?.[0];
  const priceId = firstItem?.price?.id ?? current.get("stripePriceId") ?? null;
  // Resolve the period from the object/item/trial (see resolveSubscriptionPeriod
  // — the top-level current_period_* fields are absent on recent API versions),
  // then fall back to the stored value.
  const period = resolveSubscriptionPeriod(object, firstItem);
  const mappedPlan = priceId ? planForPrice(priceId) : undefined;
  // The entry plan is the floor for a subscription whose price we
  // cannot map. It was "solo", which no longer exists — a webhook for an
  // unrecognised price would have written a plan key nothing can resolve.
  const plan =
    mappedPlan ??
    (current.get("plan") as keyof typeof entitlements | undefined) ??
    "studio";
  const status = deleted ? "cancelled" : normalizeStatus(object.status);
  const discount = await discountFromStripe(subscriptionReference.firestore, object);
  // Another studio's referral code ties this studio to it (saas/referrals.ts).
  const subscriptionMetadata = (object.metadata ?? {}) as Record<string, unknown>;
  const referrerTenantId = typeof subscriptionMetadata.referrerTenantId === "string" ? subscriptionMetadata.referrerTenantId : "";
  await (referrerTenantId
    ? recordReferral(subscriptionReference.firestore, {
        tenantId,
        referrerTenantId,
        code: String(subscriptionMetadata.referralCode ?? ""),
        via: typeof subscriptionMetadata.referralVia === "string" ? subscriptionMetadata.referralVia : null,
        status,
        now,
      })
    : updateReferralStatus(subscriptionReference.firestore, tenantId, status, now)
  ).catch((caught: unknown) => {
    console.error(JSON.stringify({ severity: "ERROR", event: "referral.record_failed", tenantId, reason: caught instanceof Error ? caught.message : String(caught) }));
  });
  // A studio the team comped locally (no Stripe subscription) that then pays
  // is no longer comped. One comped with a 100% coupon keeps its flag: that
  // subscription is how the comp is carried.
  const localComp = current.get("comped") === true && current.get("compMode") !== "stripe_coupon";
  const live = !deleted && ["trialing", "active", "past_due"].includes(status);
  // When the trouble started, for the access rule's clocks
  // (subscription-access.ts): grace runs from the first past-due write, the
  // read-only window from the cancellation. Kept while the status holds,
  // cleared when it moves on, so a second failure months later gets a fresh
  // grace period.
  const previousStatus = current.exists ? String(current.get("status") ?? "") : "";
  const pastDueSince =
    status === "past_due"
      ? previousStatus === "past_due"
        ? ((current.get("pastDueSince") as string | undefined) ?? now)
        : now
      : null;
  const cancelledAt =
    status === "cancelled"
      ? previousStatus === "cancelled"
        ? ((current.get("cancelledAt") as string | undefined) ?? now)
        : now
      : null;
  batch.set(
    subscriptionReference,
    {
      id: tenantId,
      tenantId,
      plan,
      cadence:
        priceId && mappedPlan
          ? cadenceForPrice(priceId)
          : (current.get("cadence") ?? "monthly"),
      status,
      pastDueSince,
      cancelledAt,
      ...(typeof eventCreated === "number" ? { lastStripeEventCreated: eventCreated } : {}),
      stripeCustomerId: String(
        object.customer ?? current.get("stripeCustomerId") ?? "",
      ),
      stripeSubscriptionId: String(
        object.id ?? current.get("stripeSubscriptionId") ?? "",
      ),
      stripePriceId: priceId,
      currentPeriodStart:
        period.start ?? (current.get("currentPeriodStart") ?? null),
      currentPeriodEnd:
        period.end ?? (current.get("currentPeriodEnd") ?? null),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
      unitAmountCents:
        typeof firstItem?.price?.unit_amount === "number"
          ? firstItem.price.unit_amount
          : (current.get("unitAmountCents") ?? null),
      ...(discount !== undefined ? { discount } : {}),
      ...(localComp && live ? { comped: false, compEndsAt: null, compMode: null, checkoutRequired: false } : {}),
      // Applied by Checkout; the next one must not apply it again.
      ...(live ? { pendingCouponId: null, trialEndOverride: null } : {}),
      entitlements: entitlements[plan],
      internalUserCount: current.get("internalUserCount") ?? 0,
      brandCount: current.get("brandCount") ?? 1,
      activeSubcontractorCount:
        current.get("activeSubcontractorCount") ?? 0,
      createdAt: current.get("createdAt") ?? now,
      updatedAt: now,
      createdBy: current.get("createdBy") ?? "stripe",
      updatedBy: "stripe",
      archivedAt: null,
    },
    { merge: true },
  );
  return { status, plan };
}


/**
 * The discount on a subscription as the Console shows it, or null for none.
 * `undefined` means the event didn't say, so the stored summary stands.
 *
 * Older API versions send `discount` as an object; newer ones send only
 * `discounts` ids, in which case the subscription is read back at a pinned
 * version that still returns the object.
 */
async function discountFromStripe(db: FirebaseFirestore.Firestore, object: Record<string, unknown>) {
  let discount = object.discount as Record<string, unknown> | null | undefined;
  const ids = Array.isArray(object.discounts) ? object.discounts : null;
  if (discount === undefined && ids) {
    if (!ids.length) return null;
    const firstObject = ids.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
    if (firstObject) discount = firstObject;
    else if (process.env.STRIPE_SECRET_KEY && typeof object.id === "string") {
      try {
        const response = await fetch(
          `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(object.id)}?expand[]=discount.promotion_code`,
          { headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "stripe-version": STRIPE_ADMIN_API_VERSION } },
        );
        if (!response.ok) return undefined;
        discount = ((await response.json()) as Record<string, unknown>).discount as Record<string, unknown> | null;
      } catch {
        return undefined;
      }
    } else return undefined;
  }
  if (discount === undefined) return undefined;
  if (!discount) return null;
  const coupon = (discount.coupon ?? (discount.source as Record<string, unknown> | undefined)?.coupon) as
    | Record<string, unknown>
    | undefined;
  if (!coupon || typeof coupon !== "object") return undefined;
  const promotion = discount.promotion_code;
  let code: string | null = null;
  if (promotion && typeof promotion === "object") code = String((promotion as Record<string, unknown>).code ?? "") || null;
  else if (typeof promotion === "string") {
    const mirror = await db.doc(`saasDiscounts/${promotion}`).get();
    code = typeof mirror.get("code") === "string" ? String(mirror.get("code")) : null;
  }
  const duration =
    coupon.duration === "once" || coupon.duration === "repeating" || coupon.duration === "forever" ? coupon.duration : "once";
  return {
    code,
    couponId: typeof coupon.id === "string" ? coupon.id : null,
    percentOff: typeof coupon.percent_off === "number" ? coupon.percent_off : null,
    amountOffCents: typeof coupon.amount_off === "number" ? coupon.amount_off : null,
    duration,
    durationMonths: typeof coupon.duration_in_months === "number" ? coupon.duration_in_months : null,
    endsAt: fromUnix(discount.end),
  };
}

/**
 * The billing email an invoice event calls for, if any: every failed attempt,
 * and the first paid invoice after a failure. A routine renewal sends nothing
 * (Stripe's own receipts are an account-wide setting shared with the other
 * products).
 */
async function queueInvoiceNotice(
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  invoice: Record<string, unknown>,
  type: "invoice.payment_failed" | "invoice.paid",
) {
  const invoiceId = String(invoice.id ?? "");
  if (!invoiceId) return;
  const [subscription, tenant] = await Promise.all([
    db.doc(`subscriptions/${tenantId}`).get(),
    db.doc(`tenants/${tenantId}`).get(),
  ]);
  const currency = String(invoice.currency ?? "usd").toUpperCase();
  const money = (cents: unknown) => {
    const value = Number(cents);
    return Number.isFinite(value) && value > 0
      ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value / 100)
      : null;
  };
  const zone = String(tenant.get("timezone") ?? "") || "America/New_York";
  if (type === "invoice.payment_failed") {
    await queueBillingNotice(db, {
      tenantId,
      type: "billing_payment_failed",
      dedupeKey: `${invoiceId}_${Number(invoice.attempt_count ?? 0)}`,
      values: {
        amountText: money(invoice.amount_due),
        graceEndText: longDateIn(graceEndsAt(subscription.get("pastDueSince"), Date.now()), zone),
      },
    });
    return;
  }
  // Paid: only a recovery, and only once money actually moved.
  if (!subscription.get("lastPaymentFailedAt") || !(Number(invoice.amount_paid ?? 0) > 0)) return;
  await queueBillingNotice(db, {
    tenantId,
    type: "billing_payment_recovered",
    dedupeKey: invoiceId,
    values: { amountText: money(invoice.amount_paid) },
  });
}

/** Which studio an invoice belongs to: its subscription's metadata, or its customer. */
async function tenantForInvoice(db: FirebaseFirestore.Firestore, invoice: Record<string, unknown>): Promise<string | null> {
  const details = (invoice.subscription_details ??
    (invoice.parent as Record<string, unknown> | undefined)?.subscription_details) as Record<string, unknown> | undefined;
  const fromMetadata = (details?.metadata as Record<string, unknown> | undefined)?.tenantId;
  // The account is shared with other products, whose subscriptions may carry
  // a tenantId of their own. Only a studio StudioCue has is recorded, so an
  // invoice from elsewhere can't create a subscription record by merging.
  if (typeof fromMetadata === "string" && fromMetadata)
    return (await db.doc(`subscriptions/${fromMetadata}`).get()).exists ? fromMetadata : null;
  const customer = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customer) return null;
  const match = await db.collection("subscriptions").where("stripeCustomerId", "==", customer).limit(1).get();
  return match.docs[0]?.id ?? null;
}

/**
 * Mirror a StudioCue invoice for the Console's Revenue page, and remember a
 * failed payment on the subscription so the studio's health shows it.
 */
function recordInvoice(
  batch: WriteBatch,
  db: FirebaseFirestore.Firestore,
  tenantId: string,
  invoice: Record<string, unknown>,
  type: string,
  now: string,
) {
  const id = String(invoice.id ?? "");
  if (!id) return;
  const sum = (value: unknown) =>
    Array.isArray(value) ? value.reduce((total, item) => total + Number((item as { amount?: number }).amount ?? 0), 0) : 0;
  batch.set(
    db.doc(`saasInvoices/${id}`),
    {
      id,
      tenantId,
      number: invoice.number ?? null,
      status: invoice.status ?? null,
      billingReason: invoice.billing_reason ?? null,
      currency: invoice.currency ?? "usd",
      subtotalCents: Number(invoice.subtotal ?? 0),
      totalCents: Number(invoice.total ?? 0),
      amountPaidCents: Number(invoice.amount_paid ?? 0),
      amountDueCents: Number(invoice.amount_due ?? 0),
      discountCents: sum(invoice.total_discount_amounts),
      attemptCount: Number(invoice.attempt_count ?? 0),
      nextPaymentAttemptAt: fromUnix(invoice.next_payment_attempt),
      hostedInvoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : null,
      customerId: typeof invoice.customer === "string" ? invoice.customer : null,
      createdAt: fromUnix(invoice.created) ?? now,
      paidAt:
        type === "invoice.paid"
          ? (fromUnix((invoice.status_transitions as Record<string, unknown> | undefined)?.paid_at) ?? now)
          : null,
      lastEvent: type,
      updatedAt: now,
    },
    { merge: true },
  );
  if (type === "invoice.payment_failed")
    batch.set(db.doc(`subscriptions/${tenantId}`), { lastPaymentFailedAt: now, updatedAt: now }, { merge: true });
  if (type === "invoice.paid" && Number(invoice.amount_paid ?? 0) > 0)
    batch.set(db.doc(`subscriptions/${tenantId}`), { lastPaymentFailedAt: null, lastPaidAt: now, updatedAt: now }, { merge: true });
}
