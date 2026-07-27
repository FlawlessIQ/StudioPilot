import { createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck, requireIdentity } from "../crm/security.js";
import { studioHubCors } from "../security/cors.js";

const billingCommandSchema = z.object({
  type: z.enum(["createCheckout", "createPortal"]),
  tenantId: z.string(),
  plan: z.enum(["solo", "studio", "multi_brand"]).optional(),
  cadence: z.enum(["monthly", "yearly"]).optional(),
});
const stripeEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  created: z.number(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
const entitlements = {
  solo: {
    maxInternalUsers: 1,
    maxBrands: 1,
    maxActiveSubcontractors: 10,
    aiActionsMonthly: 500,
    smsEnabled: false,
    coiEnabled: false,
    customWorkflowsEnabled: false,
    advancedReportingEnabled: false,
    apiAccessEnabled: false,
    prioritySupportEnabled: false,
  },
  studio: {
    maxInternalUsers: 5,
    maxBrands: 1,
    maxActiveSubcontractors: null,
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
    maxActiveSubcontractors: null,
    aiActionsMonthly: 7500,
    smsEnabled: true,
    coiEnabled: true,
    customWorkflowsEnabled: true,
    advancedReportingEnabled: true,
    apiAccessEnabled: true,
    prioritySupportEnabled: true,
  },
} as const;
const priceFor = (
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
const signatureValid = (raw: string, header: string, secret: string) => {
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
      if (process.env.PROVIDER_MOCK_MODE === "true") {
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
      const subscription = await db
        .doc(`subscriptions/${parsed.tenantId}`)
        .get();
      const customerId = subscription.get("stripeCustomerId") as
        | string
        | undefined;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://studiohub.app";
      const params = new URLSearchParams();
      if (parsed.type === "createCheckout") {
        if (!parsed.plan || !parsed.cadence) throw new Error("PLAN_REQUIRED");
        const priceId = priceFor(parsed.plan, parsed.cadence);
        if (!priceId) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
        params.set("mode", "subscription");
        params.set("line_items[0][price]", priceId);
        params.set("line_items[0][quantity]", "1");
        params.set(
          "success_url",
          `${appUrl}/studio/subscription?checkout=success`,
        );
        params.set(
          "cancel_url",
          `${appUrl}/studio/subscription?checkout=cancelled`,
        );
        params.set("subscription_data[metadata][tenantId]", parsed.tenantId);
        params.set("metadata[tenantId]", parsed.tenantId);
        if (customerId) params.set("customer", customerId);
      } else {
        if (!customerId) throw new Error("STRIPE_CUSTOMER_NOT_FOUND");
        params.set("customer", customerId);
        params.set("return_url", `${appUrl}/studio/subscription`);
      }
      const endpoint =
        parsed.type === "createCheckout"
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
    secrets: ["STRIPE_WEBHOOK_SECRET"],
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
      const metadata = object.metadata as Record<string, unknown> | undefined;
      const tenantId = String(metadata?.tenantId ?? "");
      const now = new Date().toISOString();
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
      const items = object.items as
        | { data?: Array<{ price?: { id?: string } }> }
        | undefined;
      const priceId =
        items?.data?.[0]?.price?.id ?? current.get("stripePriceId") ?? null;
      const mappedPlan = priceId ? planForPrice(priceId) : undefined;
      const plan =
        mappedPlan ??
        (current.get("plan") as keyof typeof entitlements | undefined) ??
        "solo";
      const status =
        event.type === "customer.subscription.deleted"
          ? "cancelled"
          : normalizeStatus(object.status);
      const batch = db.batch();
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
            typeof object.current_period_start === "number"
              ? new Date(object.current_period_start * 1000).toISOString()
              : (current.get("currentPeriodStart") ?? null),
          currentPeriodEnd:
            typeof object.current_period_end === "number"
              ? new Date(object.current_period_end * 1000).toISOString()
              : (current.get("currentPeriodEnd") ?? null),
          cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
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
