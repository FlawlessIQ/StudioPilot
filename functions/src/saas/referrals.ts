import type { Firestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { STUDIOCUE_METADATA, stripeMock, stripeRequest } from "../console/stripe-admin.js";
import { codeTaken } from "../console/handlers/codes.js";
import { queueBillingNotice } from "./billing-notices.js";
import {
  OFFER_MONTHLY_CENTS,
  OFFER_MONTHS,
  OFFER_YEARLY_CENTS,
  REFERRAL_CREDIT_CENTS,
  normalizeReferralCode,
  referralCodeStem,
  settlement,
} from "./referral-program.js";

/**
 * Studio referrals (features/subscriptions/referral-program.ts has the rules).
 *
 * Every studio's code lives in `saasReferralCodes/{CODE}` → tenantId, and on
 * `tenants/{id}.referralCode`. It is not a Stripe promotion code: billingCommand
 * looks it up here and applies one of two coupons, one per cadence, because a
 * single Stripe coupon can't take $600 off a year and $50 off a month.
 * `saasReferrals/{tenantId}`: the referred studio, who referred it, when it
 * first paid, and when its $100 was credited (or forfeited). It replaces the
 * partner records of 2026-10-07.
 */

const PROGRAM = "saasSettings/referralProgram";

export { emailHash } from "../communications/email-hash.js";

const studioNameOf = (tenant: FirebaseFirestore.DocumentSnapshot) =>
  String(tenant.get("brandName") ?? tenant.get("businessName") ?? tenant.get("name") ?? "").trim();

/** The studio's code, made the first time anything asks for it. */
export async function ensureReferralCode(db: Firestore, tenantId: string, now = new Date().toISOString()): Promise<string> {
  const tenantReference = db.doc(`tenants/${tenantId}`);
  const tenant = await tenantReference.get();
  if (!tenant.exists) throw new Error("TENANT_NOT_FOUND");
  const existing = normalizeReferralCode(tenant.get("referralCode"));
  if (existing) return existing;
  const stem = referralCodeStem(studioNameOf(tenant) || "STUDIO");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = attempt === 0 ? stem : `${stem.slice(0, 12)}${10 + Math.floor(Math.random() * 90)}`;
    // A beta or Console code of the same name would be shadowed by this one.
    if (await codeTaken(db, code)) continue;
    const settled = await db.runTransaction(async (transaction) => {
      const fresh = await transaction.get(tenantReference);
      const codeReference = db.doc(`saasReferralCodes/${code}`);
      const taken = await transaction.get(codeReference);
      const already = normalizeReferralCode(fresh.get("referralCode"));
      if (already) return already;
      if (taken.exists) return null;
      transaction.create(codeReference, { code, tenantId, createdAt: now });
      transaction.update(tenantReference, { referralCode: code });
      return code;
    });
    if (settled) return settled;
  }
  throw new Error("REFERRAL_CODE_UNAVAILABLE");
}

/**
 * Whose code it is: a studio's (`referrerTenantId`), or a referral partner's
 * (`partnerId`, made in the Console: console/handlers/partners.ts). A partner
 * is a planner, DJ, hair or makeup artist who isn't a StudioCue customer; their
 * code gives a photographer the same offer, and a vendor the vendor offer
 * (saas/stripe.ts), and what they earn is tallied in the Console and paid by
 * hand (features/console/partner-payouts.ts).
 */
export type ReferralMatch = {
  code: string;
  referrerTenantId: string;
  referrerName: string;
  partnerId?: string | null;
  /**
   * A vendor's own offer code (saas/vendor-offer.ts): the vendor plan's
   * offer, for the address it was made for, crediting the studio whose
   * wedding brought them. Absent for a studio's or a partner's code.
   */
  kind?: "vendor_offer";
  offerFor?: string;
};

/** The studio or partner a code belongs to, or null when it isn't a referral code. */
export async function lookupReferral(db: Firestore, rawCode: unknown): Promise<ReferralMatch | null> {
  const code = normalizeReferralCode(rawCode);
  if (!code) return null;
  const record = await db.doc(`saasReferralCodes/${code}`).get();
  const partnerId = record.get("partnerId");
  if (typeof partnerId === "string" && partnerId) {
    const partner = await db.doc(`saasPartners/${partnerId}`).get();
    if (!partner.exists || partner.get("active") === false) return null;
    const name = String(partner.get("business") || partner.get("name") || "").trim();
    return { code, referrerTenantId: "", referrerName: name || "A StudioCue partner", partnerId };
  }
  const referrerTenantId = record.get("tenantId");
  if (typeof referrerTenantId !== "string" || !referrerTenantId) return null;
  const tenant = await db.doc(`tenants/${referrerTenantId}`).get();
  if (!tenant.exists || tenant.get("archivedAt")) return null;
  const vendorOffer = record.get("kind") === "vendor_offer";
  return {
    code,
    referrerTenantId,
    referrerName: studioNameOf(tenant) || "A StudioCue studio",
    ...(vendorOffer ? { kind: "vendor_offer" as const, offerFor: String(record.get("offerFor") ?? "") } : {}),
  };
}

/**
 * The coupon for a referred studio's first year on this cadence, made once.
 *
 * Amount off rather than percent off, from the Studio list price, so yearly is
 * $900 and monthly is $100 whatever the list price is when it's made. Limited
 * to the Studio product: the offer is for the Studio plan.
 */
export async function referralCoupon(db: Firestore, cadence: "monthly" | "yearly"): Promise<string> {
  const field = cadence === "yearly" ? "yearlyCouponId" : "monthlyCouponId";
  const priceId = process.env[`STRIPE_PRICE_STUDIO_${cadence.toUpperCase()}`] ?? "";
  const target = cadence === "yearly" ? OFFER_YEARLY_CENTS : OFFER_MONTHLY_CENTS;
  // Kept for the price and offer it was made for, so a price change makes a new coupon (saas/vendor-offer.ts).
  // A coupon made before the key existed is kept: the Studio price hasn't changed since.
  const key = `${priceId}:${target}`;
  const program = await db.doc(PROGRAM).get();
  const existing = program.get(field);
  const existingKey = program.get(`${field}Key`);
  if (typeof existing === "string" && existing && (existingKey === undefined || existingKey === key)) return existing;
  let couponId: string;
  if (stripeMock()) {
    couponId = `mock_referral_${cadence}`;
  } else {
    if (!priceId) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
    const price = await stripeRequest<{ unit_amount?: number | null; product?: string; currency?: string }>("GET", `prices/${encodeURIComponent(priceId)}`);
    const amountOff = Number(price.unit_amount ?? 0) - target;
    if (!(amountOff > 0) || !price.product) throw new Error("REFERRAL_OFFER_ABOVE_LIST_PRICE");
    couponId = (
      await stripeRequest<{ id: string }>("POST", "coupons", {
        name: cadence === "yearly" ? "Referral: first year $900 ($75/month)" : "Referral: $100/month for 12 months",
        amount_off: amountOff,
        currency: price.currency ?? "usd",
        // Twelve months from checkout, for both. Monthly: the first 12
        // charges. Yearly: the first annual invoice, 14 days in, and not the
        // renewal a year after that. Not "once": the first invoice of a
        // trial is the $0 one at checkout, and a once-off discount spent
        // there would leave the studio paying $1,500.
        duration: "repeating",
        duration_in_months: OFFER_MONTHS,
        "applies_to[products]": [price.product],
        "metadata[app]": STUDIOCUE_METADATA.app,
        "metadata[kind]": "referral",
      })
    ).id;
  }
  await db.doc(PROGRAM).set({ [field]: couponId, [`${field}Key`]: key, updatedAt: new Date().toISOString() }, { merge: true });
  return couponId;
}

/**
 * Tie a studio to the one whose code it signed up with. Called from the
 * subscription the referred Checkout created (its metadata carries the code),
 * so a code typed and then abandoned ties nobody. The first referrer keeps it.
 */
export async function recordReferral(
  db: Firestore,
  input: {
    tenantId: string;
    referrerTenantId: string;
    /** A referral partner's code (the Console), instead of a studio's. */
    partnerId?: string | null;
    /** The plan the referred customer took: a partner earns half for a vendor (features/console/partner-payouts.ts). */
    plan?: string | null;
    code: string;
    via: string | null;
    status: string;
    now: string;
  },
): Promise<void> {
  const partnerId = input.partnerId || null;
  if (partnerId ? false : !input.referrerTenantId || input.referrerTenantId === input.tenantId) return;
  const reference = db.doc(`saasReferrals/${input.tenantId}`);
  const [referrer, referred] = await Promise.all([
    partnerId ? db.doc(`saasPartners/${partnerId}`).get() : db.doc(`tenants/${input.referrerTenantId}`).get(),
    db.doc(`tenants/${input.tenantId}`).get(),
  ]);
  const referrerName = partnerId
    ? String(referrer.get("business") || referrer.get("name") || "").trim()
    : studioNameOf(referrer);
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    // The first referrer keeps it, studio or partner.
    if (existing.exists && (existing.get("partnerId") ?? null) !== partnerId) return;
    if (existing.exists && !partnerId && existing.get("referrerTenantId") !== input.referrerTenantId) return;
    transaction.set(
      reference,
      {
        id: input.tenantId,
        tenantId: input.tenantId,
        studioName: studioNameOf(referred) || null,
        referrerTenantId: partnerId ? "" : input.referrerTenantId,
        partnerId,
        plan: input.plan ?? existing.get("plan") ?? null,
        referrerName: referrerName || null,
        code: input.code,
        via: existing.get("via") ?? input.via ?? "code",
        status: input.status,
        signedUpAt: existing.get("signedUpAt") ?? input.now,
        paidAt: existing.get("paidAt") ?? null,
        amountPaidCents: existing.get("amountPaidCents") ?? null,
        creditedAt: existing.get("creditedAt") ?? null,
        qualifiedAt: existing.get("qualifiedAt") ?? null,
        forfeitedAt: existing.get("forfeitedAt") ?? null,
        updatedAt: input.now,
      },
      { merge: true },
    );
  });
}

/** Keep a referral's status in step with the referred studio's subscription. */
export async function updateReferralStatus(db: Firestore, tenantId: string, status: string, now: string): Promise<void> {
  const reference = db.doc(`saasReferrals/${tenantId}`);
  const existing = await reference.get();
  if (existing.exists && existing.get("status") !== status) await reference.update({ status, updatedAt: now });
}

/** The first paid invoice of a referred studio: the referral now counts. */
export async function creditReferral(
  db: Firestore,
  input: { tenantId: string; amountPaidCents: number; invoiceId: string | null; now: string },
): Promise<void> {
  if (!(input.amountPaidCents > 0)) return;
  const reference = db.doc(`saasReferrals/${input.tenantId}`);
  await db.runTransaction(async (transaction) => {
    const referral = await transaction.get(reference);
    if (!referral.exists || referral.get("paidAt")) return;
    transaction.update(reference, {
      paidAt: input.now,
      amountPaidCents: input.amountPaidCents,
      paidInvoiceId: input.invoiceId,
      updatedAt: input.now,
    });
  });
}

const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Credit every referral that's due: $100, once, to the referrer's Stripe
 * customer balance, which Stripe takes off their next invoice. Due means the
 * referred studio first paid three months ago and is still paying, and hasn't
 * scheduled its cancellation (referral-program.ts, `settlement`).
 *
 * One credit per referral, recorded in `saasReferralCredits/{referred tenant}`
 * and sent to Stripe under that key, so a rerun after a partial failure
 * neither credits twice nor skips one. A referrer with no Stripe customer, or
 * no longer subscribed, is held, not forfeited: it's looked at again tomorrow.
 */
export async function settleReferralCredits(db: Firestore, nowIso: string): Promise<{ credited: number; forfeited: number; held: number }> {
  const open = await db.collection("saasReferrals").where("creditedAt", "==", null).get();
  let credited = 0;
  let forfeited = 0;
  let held = 0;
  for (const referral of open.docs) {
    try {
      if (referral.get("forfeitedAt")) continue;
      const subscription = await db.doc(`subscriptions/${referral.id}`).get();
      // A studio that has already asked to leave isn't one to pay for.
      const status = subscription.get("cancelAtPeriodEnd") === true ? "cancel_scheduled" : String(subscription.get("status") ?? "");
      const referrerTenantId = String(referral.get("referrerTenantId") ?? "");
      const decision = settlement(
        {
          tenantId: referral.id,
          referrerTenantId,
          paidAt: referral.get("paidAt") ?? null,
          creditedAt: referral.get("creditedAt") ?? null,
          forfeitedAt: referral.get("forfeitedAt") ?? null,
        },
        status,
        nowIso,
      );
      if (decision === "forfeit") {
        await referral.ref.update({ forfeitedAt: nowIso, forfeitReason: "canceled", updatedAt: nowIso });
        forfeited += 1;
        continue;
      }
      if (decision !== "credit") {
        if (decision === "hold") held += 1;
        continue;
      }
      // A partner's referral: it now counts toward what they're owed, which
      // the Console tallies and the team pays by hand. No Stripe credit: a
      // partner has no StudioCue bill. `creditedAt` marks it settled.
      if (referral.get("partnerId")) {
        await referral.ref.update({ qualifiedAt: nowIso, creditedAt: nowIso, creditKind: "partner", updatedAt: nowIso });
        credited += 1;
        continue;
      }
      const creditReference = db.doc(`saasReferralCredits/${referral.id}`);
      const prior = await creditReference.get();
      let transactionId = prior.exists ? String(prior.get("stripeBalanceTransactionId") ?? "") : "";
      if (!prior.exists) {
        const referrer = await db.doc(`subscriptions/${referrerTenantId}`).get();
        const customerId = String(referrer.get("stripeCustomerId") ?? "");
        if (!customerId || !["trialing", "active", "past_due"].includes(String(referrer.get("status") ?? ""))) {
          logger.info("referral_credit_held", { referrerTenantId, tenantId: referral.id, reason: customerId ? referrer.get("status") : "no_customer" });
          held += 1;
          continue;
        }
        transactionId = stripeMock()
          ? `mock_cbtxn_${referral.id}`
          : (
              await stripeRequest<{ id: string }>(
                "POST",
                `customers/${encodeURIComponent(customerId)}/balance_transactions`,
                {
                  amount: -REFERRAL_CREDIT_CENTS,
                  currency: "usd",
                  description: `Referral credit: ${String(referral.get("studioName") ?? "") || "a studio you referred"}`,
                  "metadata[app]": STUDIOCUE_METADATA.app,
                  "metadata[kind]": "referral_credit",
                  "metadata[referredTenantId]": referral.id,
                  "metadata[tenantId]": referrerTenantId,
                },
                `referral-credit-${referral.id}`,
              )
            ).id;
      }
      const batch = db.batch();
      batch.set(creditReference, {
        id: referral.id,
        referredTenantId: referral.id,
        referrerTenantId,
        amountCents: REFERRAL_CREDIT_CENTS,
        stripeBalanceTransactionId: transactionId,
        createdAt: prior.get("createdAt") ?? nowIso,
      });
      batch.update(referral.ref, { creditedAt: nowIso, creditId: referral.id, updatedAt: nowIso });
      await batch.commit();
      credited += 1;
      await queueBillingNotice(db, {
        tenantId: referrerTenantId,
        type: "billing_referral_credit",
        dedupeKey: referral.id,
        values: { amountText: money(REFERRAL_CREDIT_CENTS) },
      }).catch((caught: unknown) => logger.warn("referral_credit_notice_failed", { referrerTenantId, error: caught instanceof Error ? caught.message : String(caught) }));
    } catch (caught: unknown) {
      logger.error("referral_credit_failed", { tenantId: referral.id, error: caught instanceof Error ? caught.message : String(caught) });
    }
  }
  return { credited, forfeited, held };
}

/** Once a day: the referrals that reached three months of paying. */
export const referralCreditScheduler = onSchedule(
  { schedule: "every day 14:00", timeZone: "UTC", retryCount: 2, secrets: ["STRIPE_SECRET_KEY"] },
  async () => {
    const result = await settleReferralCredits(getFirestore(), new Date().toISOString());
    logger.info("referral_credits_settled", result);
  },
);
