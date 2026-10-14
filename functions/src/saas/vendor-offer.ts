import { randomBytes } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { isReservedTestAddress } from "../communications/test-address.js";
import { appUrl } from "../console/studio-owner.js";
import { tradeProfile, vendorTypeIsLive, vendorTypeLiveTrades } from "../trades/trades.js";
import { emailHash } from "../communications/email-hash.js";
import { STUDIOCUE_METADATA, stripeMock, stripeRequest } from "../console/stripe-admin.js";

/**
 * The vendor offer (docs/vendor-network-plan-2026-10-12.md, Phase 3; Conor's
 * D1, 2026-10-13): a vendor who worked a StudioCue studio's wedding, and runs
 * a trade StudioCue has a journey for, gets the vendor plan at **$50/month for
 * the first 12 months, or $500 for the first year** (list $75 / $750), after
 * the same 14-day trial. The studio whose wedding it was earns the referral
 * credit when the vendor has paid for three months (D2), through the ordinary
 * referral settlement: the vendor's subscription carries `referrerTenantId`
 * and `referralVia: "vendor_offer"`.
 *
 * Each vendor gets a code of their own (`saasReferralCodes/{CODE}`, `kind:
 * "vendor_offer"`, `offerFor` their address's hash), kept on their once-ever
 * record (`vendorInvites/{sha256(email)}`, `offerCode`). The code is random —
 * not derived from the address — so knowing a vendor's email is not knowing
 * their discount.
 *
 * Who: the vendor's trade has a live journey on the vendor plan (DJ, hair and
 * makeup, planner). A videographer or photographer is offered the Studio
 * plan's referral price with the studio's own code instead, as vendor invites
 * always have. Never to a subscriber (an owner or admin of a studio that is
 * trialing or paying — a couple's or crew member's login is not one), an
 * address that unsubscribed, a test address, or the vendors of a studio that
 * turned invites off or isn't trialing or paying.
 *
 * Pure parts are mirrored in features/subscriptions/vendor-offer.ts
 * (tests/vendor-offer.test.ts fails on a drift).
 */

export const VENDOR_OFFER_MONTHLY_CENTS = 5_000;
export const VENDOR_OFFER_YEARLY_CENTS = 50_000;
export const VENDOR_OFFER_MONTHS = 12;
export const VENDOR_OFFER_SUMMARY = "14 days free, then $50/month for your first 12 months, or $500 for your first year";
/** The same, said about someone else: a referrer's card, the Console, a partner's file. */
export const VENDOR_OFFER_SUMMARY_THEIRS = "14 days free, then $50/month for their first 12 months, or $500 for their first year";

const PROGRAM = "saasSettings/referralProgram";

export type VendorOfferAudience = "vendor" | "studio";

/**
 * Which offer a kind of vendor gets: the vendor plan's ("vendor"), the Studio
 * plan's referral price ("studio": a videographer signs up as a photographer),
 * or none (a florist, a caterer: no journey yet, captured but not offered).
 */
export function vendorOfferAudience(vendorType: unknown): VendorOfferAudience | null {
  const type = typeof vendorType === "string" ? vendorType : "";
  if (!vendorTypeIsLive(type)) return null;
  const trades = vendorTypeLiveTrades(type);
  if (!trades.length) return null;
  if (trades.some((trade) => tradeProfile(trade).family === "photo")) return "studio";
  return trades.every((trade) => tradeProfile(trade).plans.includes("vendor")) ? "vendor" : null;
}

/** Where the offer's button goes: the signup with the vendor's trade chosen, the vendor plan and their code. */
export function vendorOfferLink(input: { vendorType: string; code: string; medium: "email" | "share" }): string {
  const trades = vendorTypeLiveTrades(input.vendorType);
  const query = new URLSearchParams();
  if (trades.length === 1) query.set("trade", trades[0]!);
  query.set("plan", "vendor");
  query.set("code", input.code);
  query.set("utm_source", "vendor_offer");
  query.set("utm_medium", input.medium);
  return `/auth/register?${query.toString()}`;
}

/** A code for one vendor: "VO" and eight random letters and digits, no look-alikes. */
export function newVendorOfferCode(random: (size: number) => Buffer = randomBytes): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = random(8);
  let code = "VO";
  for (const byte of bytes) code += alphabet[byte % alphabet.length];
  return code;
}

/** Whether the address owns or runs a studio that is trialing or paying. A couple or crew login is not a subscriber. */
export async function isSubscriber(db: Firestore, email: string): Promise<boolean> {
  let uid: string;
  try {
    uid = (await getAuth().getUserByEmail(email)).uid;
  } catch (caught: unknown) {
    if ((caught as { code?: string })?.code === "auth/user-not-found") return false;
    throw caught;
  }
  const memberships = await db.collection("memberships").where("userId", "==", uid).limit(20).get();
  for (const membership of memberships.docs) {
    if (!["studio_owner", "studio_admin"].includes(String(membership.get("role") ?? ""))) continue;
    if (membership.get("status") && membership.get("status") !== "active") continue;
    const subscription = await db.doc(`subscriptions/${String(membership.get("tenantId") ?? "")}`).get();
    if (["trialing", "active", "past_due"].includes(String(subscription.get("status") ?? ""))) return true;
  }
  return false;
}

export type VendorOffer = {
  audience: VendorOfferAudience;
  /** The vendor's own code (vendor plan), or the studio's referral code (Studio plan). */
  code: string;
  actionUrl: string;
  unsubscribeUrl: string;
  studioName: string;
  /** The vendor's trades, so the copy names theirs ("StudioCue runs your DJ bookings"). */
  trades: string[];
  /** This is the first StudioCue has ever written to the address about StudioCue. */
  firstContact: boolean;
};

export type VendorOfferInput = {
  tenantId: string;
  projectId: string;
  vendorId: string;
  vendorType: string;
  email: string;
  /** What is offering it: the timeline email, or the daily invite sweep. */
  source: "vendor_timeline" | "vendor_invite";
  emailJobId: string | null;
  now: string;
  /** Overridable for tests. */
  subscriber?: (email: string) => Promise<boolean>;
};

/**
 * The offer for one vendor, or null when they aren't offered one. Writes the
 * once-ever record when it is the first contact, and the vendor's code the
 * first time one is needed — both inside a transaction, so two sends at once
 * make one record and one code.
 */
export async function ensureVendorOffer(db: Firestore, input: VendorOfferInput): Promise<VendorOffer | null> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@") || isReservedTestAddress(email)) return null;
  const audience = vendorOfferAudience(input.vendorType);
  if (!audience) return null;
  const hash = emailHash(email);
  const [tenant, subscription, suppressed] = await Promise.all([
    db.doc(`tenants/${input.tenantId}`).get(),
    db.doc(`subscriptions/${input.tenantId}`).get(),
    db.doc(`emailSuppressions/${hash}`).get(),
  ]);
  if (suppressed.exists) return null;
  if (!tenant.exists || tenant.get("archivedAt") || tenant.get("vendorInvitesEnabled") === false) return null;
  if (!["trialing", "active"].includes(String(subscription.get("status") ?? ""))) return null;
  const studioName = String(tenant.get("brandName") ?? tenant.get("businessName") ?? tenant.get("name") ?? "").trim();
  if (!studioName) return null;
  // The studio's own client, under a vendor record ("one address in two roles").
  const asClient = await db.collection("contacts").where("tenantId", "==", input.tenantId).where("email", "==", email).limit(1).get();
  if (!asClient.empty) return null;
  if (await (input.subscriber ?? ((address: string) => isSubscriber(db, address)))(email)) return null;

  // A videographer: the studio's own referral code, on the Studio plan.
  const studioCode = audience === "studio" ? await studioReferralCode(db, input.tenantId, input.now) : null;
  const inviteReference = db.doc(`vendorInvites/${hash}`);
  const outcome = await db.runTransaction(async (transaction) => {
    const invite = await transaction.get(inviteReference);
    let code = studioCode ?? (typeof invite.get("offerCode") === "string" ? (invite.get("offerCode") as string) : "");
    let codeReference: FirebaseFirestore.DocumentReference | null = null;
    if (!code) {
      for (let attempt = 0; attempt < 5 && !codeReference; attempt += 1) {
        const candidate = newVendorOfferCode();
        const reference = db.doc(`saasReferralCodes/${candidate}`);
        if (!(await transaction.get(reference)).exists) {
          code = candidate;
          codeReference = reference;
        }
      }
      if (!codeReference) throw new Error("VENDOR_OFFER_CODE_UNAVAILABLE");
    }
    const token = typeof invite.get("unsubscribeToken") === "string" ? (invite.get("unsubscribeToken") as string) : randomBytes(18).toString("base64url");
    if (codeReference)
      transaction.create(codeReference, {
        code,
        kind: "vendor_offer",
        // The studio whose wedding brought them: credited when they've paid three months (D2).
        tenantId: input.tenantId,
        offerFor: hash,
        projectId: input.projectId,
        vendorType: input.vendorType,
        createdAt: input.now,
      });
    if (!invite.exists) {
      transaction.create(inviteReference, {
        id: hash,
        tenantId: input.tenantId,
        vendorId: input.vendorId,
        projectId: input.projectId,
        vendorType: input.vendorType,
        code,
        ...(audience === "vendor" ? { offerCode: code } : {}),
        source: input.source,
        unsubscribeToken: token,
        emailJobId: input.emailJobId,
        createdAt: input.now,
      });
    } else if (audience === "vendor" && !invite.get("offerCode")) {
      // Invited before the offer existed: the offer joins their record, the pitch is not repeated.
      transaction.update(inviteReference, { offerCode: code, offerAddedAt: input.now });
    }
    // A retry of the send that made the record is still that first contact.
    const firstContact = !invite.exists || (input.emailJobId !== null && invite.get("emailJobId") === input.emailJobId);
    return { code, token, firstContact };
  });
  return {
    audience,
    code: outcome.code,
    actionUrl: appUrl(
      audience === "vendor"
        ? vendorOfferLink({ vendorType: input.vendorType, code: outcome.code, medium: "email" })
        : `/auth/register?${new URLSearchParams({ code: outcome.code, utm_source: "vendor_offer", utm_medium: "email" }).toString()}`,
    ),
    unsubscribeUrl: appUrl(`/api/public/unsubscribe?e=${hash}&t=${outcome.token}`),
    studioName,
    trades: [...vendorTypeLiveTrades(input.vendorType)],
    firstContact: outcome.firstContact,
  };
}

/** The studio's referral code (saas/referrals.ts), imported lazily so this module stays light for tests. */
async function studioReferralCode(db: Firestore, tenantId: string, now: string): Promise<string> {
  const { ensureReferralCode } = await import("./referrals.js");
  return ensureReferralCode(db, tenantId, now);
}

/**
 * The vendor plan's offer coupon, made the first time it is needed (beside the
 * Studio plan's in `saasSettings/referralProgram`). Twelve months, never
 * "once": a trial's first invoice is the $0 one at checkout, and a once-off
 * discount spent there would leave the vendor paying list price (81ebcf4b).
 * Monthly: the first 12 charges. Yearly: the first annual invoice only.
 */
export async function vendorOfferCoupon(db: Firestore, cadence: "monthly" | "yearly"): Promise<string> {
  const field = cadence === "yearly" ? "vendorYearlyCouponId" : "vendorMonthlyCouponId";
  const program = await db.doc(PROGRAM).get();
  const existing = program.get(field);
  if (typeof existing === "string" && existing) return existing;
  let couponId: string;
  if (stripeMock()) {
    couponId = `mock_vendor_offer_${cadence}`;
  } else {
    const priceId = process.env[`STRIPE_PRICE_VENDOR_${cadence.toUpperCase()}`];
    if (!priceId) throw new Error("STRIPE_PRICE_NOT_CONFIGURED");
    const price = await stripeRequest<{ unit_amount?: number | null; product?: string; currency?: string }>("GET", `prices/${encodeURIComponent(priceId)}`);
    const target = cadence === "yearly" ? VENDOR_OFFER_YEARLY_CENTS : VENDOR_OFFER_MONTHLY_CENTS;
    const amountOff = Number(price.unit_amount ?? 0) - target;
    if (!(amountOff > 0) || !price.product) throw new Error("VENDOR_OFFER_ABOVE_LIST_PRICE");
    couponId = (
      await stripeRequest<{ id: string }>("POST", "coupons", {
        name: cadence === "yearly" ? "Vendor offer: first year $500" : "Vendor offer: $50/month for 12 months",
        amount_off: amountOff,
        currency: price.currency ?? "usd",
        duration: "repeating",
        duration_in_months: VENDOR_OFFER_MONTHS,
        "applies_to[products]": [price.product],
        "metadata[app]": STUDIOCUE_METADATA.app,
        "metadata[kind]": "vendor_offer",
      })
    ).id;
  }
  await db.doc(PROGRAM).set({ [field]: couponId, updatedAt: new Date().toISOString() }, { merge: true });
  return couponId;
}

/**
 * The offer on a `vendor_timeline` email (planning/vendor-team.ts
 * sendTimelineToVendorTeam), decided as it goes: the vendor and their kind
 * from the share it links to. A failure here never holds the timeline back —
 * the schedule is the email's point, the offer is a footnote to it.
 */
export async function vendorTimelineOffer(
  db: Firestore,
  job: { id: string; get(field: string): unknown },
  now: string,
): Promise<VendorOffer | null> {
  try {
    const shareId = String(job.get("vendorShareId") ?? "");
    const email = String(job.get("recipient") ?? "");
    const tenantId = String(job.get("tenantId") ?? "");
    const projectId = String(job.get("projectId") ?? "");
    if (!shareId || !email || !tenantId || !projectId) return null;
    const share = await db.doc(`scheduleShares/${shareId}`).get();
    if (!share.exists || share.get("tenantId") !== tenantId) return null;
    const vendorId = String(share.get("vendorContactId") ?? "");
    const vendor = vendorId ? await db.doc(`vendors/${vendorId}`).get() : null;
    const vendorType = String(vendor?.get("type") ?? share.get("vendorType") ?? "");
    return await ensureVendorOffer(db, { tenantId, projectId, vendorId, vendorType, email, source: "vendor_timeline", emailJobId: job.id, now });
  } catch (caught: unknown) {
    console.warn("vendor_offer_skipped", job.id, caught instanceof Error ? caught.message : String(caught));
    return null;
  }
}
