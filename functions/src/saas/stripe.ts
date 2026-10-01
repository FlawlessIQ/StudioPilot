import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type WriteBatch,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
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

const billingCommandSchema = z.object({
  type: z.enum(["createCheckout", "createPortal", "confirmCheckout"]),
  tenantId: z.string(),
  /** confirmCheckout: the Checkout Session Stripe returned to (session_id). */
  sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/).max(200).optional(),
  plan: z.enum(["studio", "multi_brand"]).optional(),
  cadence: z.enum(["monthly", "yearly"]).optional(),
  /**
   * createCheckout: a promotion code carried from the signup link
   * (`/auth/register?code=BETA`). Optional and never trusted for anything but
   * a lookup — Stripe decides whether it is valid and what it is worth.
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
const normalizeStatus = (
  value: unknown,
):
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancelled"
  | "incomplete" =>
  value === "trialing" ||
  value === "active" ||
  value === "past_due" ||
  value === "paused" ||
  value === "incomplete"
    ? value
    : value === "canceled" || value === "cancelled"
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
        ["trialing", "active", "past_due", "paused"].includes(
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
        const priceId = priceFor(parsed.plan, parsed.cadence);
        if (!priceId) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
        // A comped studio choosing to pay starts paying now: its stored
        // period end is the comp's (once 2099), which Stripe refuses as a
        // trial end, and it has had the product already. A trial extended in
        // the Console before the card was added is honoured instead of the
        // fresh 14 days (docs/console.md, "Billing").
        const comped = subscription.get("comped") === true;
        const override = subscription.get("trialEndOverride") as string | undefined;
        const overrideLive = Boolean(override && Date.parse(override) > Date.now() + 60_000);
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
          // First checkout (never subscribed) starts a fresh 14-day trial
          // anchored at checkout; see buildStripeCheckoutParams. `incomplete`
          // is exactly the between-onboarding-and-checkout state, and any
          // trialing/active/past_due/paused subscription was rerouted to the
          // portal above, so this only ever grants a new trial to a genuine
          // first-timer (or a cancelled tenant with no live trial to honour).
          firstCheckout: !comped && !overrideLive && normalizeStatus(existingStatus) === "incomplete",
          // Beta codes: a code from the signup link is applied up front; with
          // none (or one Stripe won't honour) Checkout offers its own field.
          promotion: await lookupPromotion(secret, parsed.promotionCode),
        });
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
      const message =
        caught instanceof Error ? caught.message : "BILLING_COMMAND_FAILED";
      response
        .status(message === "FORBIDDEN" ? 403 : 400)
        .json({ error: message });
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
      const current = await subscriptionReference.get();
      const batch = db.batch();
      const { status, plan } = await writeSubscriptionFromStripe(
        batch,
        subscriptionReference,
        current,
        tenantId,
        object,
        event.type === "customer.subscription.deleted",
        now,
      );
      batch.create(eventReference, {
        id: `stripe_${event.id}`,
        tenantId,
        provider: "stripe",
        providerEventId: event.id,
        type: event.type,
        status: "processed",
        createdAt: now,
      });
      batch.create(db.doc(`auditEvents/stripe_${event.id}`), {
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
      await batch.commit();
      response.status(200).json({ received: true });
    } catch {
      response.status(400).send("WEBHOOK_PROCESSING_FAILED");
    }
  },
);

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
  batch: WriteBatch,
  subscriptionReference: DocumentReference,
  current: DocumentSnapshot,
  tenantId: string,
  object: Record<string, unknown>,
  deleted: boolean,
  now: string,
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
  // A studio the team comped locally (no Stripe subscription) that then pays
  // is no longer comped. One comped with a 100% coupon keeps its flag: that
  // subscription is how the comp is carried.
  const localComp = current.get("comped") === true && current.get("compMode") !== "stripe_coupon";
  const live = !deleted && ["trialing", "active", "past_due"].includes(status);
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

/** Which studio an invoice belongs to: its subscription's metadata, or its customer. */
async function tenantForInvoice(db: FirebaseFirestore.Firestore, invoice: Record<string, unknown>): Promise<string | null> {
  const details = (invoice.subscription_details ??
    (invoice.parent as Record<string, unknown> | undefined)?.subscription_details) as Record<string, unknown> | undefined;
  const fromMetadata = (details?.metadata as Record<string, unknown> | undefined)?.tenantId;
  if (typeof fromMetadata === "string" && fromMetadata) return fromMetadata;
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
