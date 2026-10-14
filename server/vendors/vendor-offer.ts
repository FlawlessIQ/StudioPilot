import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { adminAuth } from "@/server/firebase/admin";
import { vendorOfferAudience, vendorOfferHeadline, vendorOfferLink, VENDOR_OFFER_SUMMARY } from "@/features/subscriptions/vendor-offer";

/**
 * The offer on a vendor's share page (app/share/[token]): shown each time
 * they open it, while they're offered one. Read only — the code and the
 * once-ever record are made when their timeline email goes
 * (functions/src/saas/vendor-offer.ts), so a vendor whose link was never
 * emailed (a studio that copied it by hand) sees no offer.
 */

export type ShareOffer = { headline: string; summary: string; code: string; url: string; studioName: string };

const emailHash = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

async function subscriberEmail(db: Firestore, email: string): Promise<boolean> {
  const user = await adminAuth.getUserByEmail(email).catch(() => null);
  if (!user) return false;
  const memberships = await db.collection("memberships").where("userId", "==", user.uid).limit(20).get();
  for (const membership of memberships.docs) {
    if (!["studio_owner", "studio_admin"].includes(String(membership.get("role") ?? ""))) continue;
    const subscription = await db.doc(`subscriptions/${String(membership.get("tenantId") ?? "")}`).get();
    if (["trialing", "active", "past_due"].includes(String(subscription.get("status") ?? ""))) return true;
  }
  return false;
}

export async function shareOfferFor(
  db: Firestore,
  input: { tenantId: string; vendorId: string; studioName: string },
): Promise<ShareOffer | null> {
  if (!input.vendorId) return null;
  const vendor = await db.doc(`vendors/${input.vendorId}`).get();
  if (!vendor.exists || vendor.get("tenantId") !== input.tenantId) return null;
  const email = String(vendor.get("email") ?? "").trim().toLowerCase();
  const vendorType = String(vendor.get("type") ?? "");
  if (!email.includes("@") || vendorOfferAudience(vendorType) !== "vendor") return null;
  const hash = emailHash(email);
  const [invite, suppressed, tenant, subscription] = await Promise.all([
    db.doc(`vendorInvites/${hash}`).get(),
    db.doc(`emailSuppressions/${hash}`).get(),
    db.doc(`tenants/${input.tenantId}`).get(),
    db.doc(`subscriptions/${input.tenantId}`).get(),
  ]);
  const code = String(invite.get("offerCode") ?? "");
  // Gone once they've signed up with it (the webhook marks it); an opened and
  // abandoned checkout doesn't take the offer away.
  if (!code || suppressed.exists || invite.get("signedUpTenantId")) return null;
  if (tenant.get("vendorInvitesEnabled") === false || !["trialing", "active"].includes(String(subscription.get("status") ?? ""))) return null;
  if (await subscriberEmail(db, email)) return null;
  return {
    headline: vendorOfferHeadline(vendorType),
    summary: VENDOR_OFFER_SUMMARY,
    code,
    url: vendorOfferLink({ vendorType, code, medium: "share" }),
    studioName: input.studioName,
  };
}

/**
 * The offer behind a signup link's `code`, for the Create-your-account page:
 * a vendor emailed "$50/month for your first 12 months" landed on "$75 a
 * month after the 14-day trial" (UAT 2026-10-13). Only a real vendor-offer
 * code nobody has signed up with yet; Checkout decides for itself
 * (functions/src/saas/stripe.ts vendorOfferBy).
 */
export async function signupOfferFor(db: Firestore, code: string): Promise<{ summary: string; studioName: string } | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^VO[A-Z0-9]{8}$/.test(normalized)) return null;
  const record = await db.doc(`saasReferralCodes/${normalized}`).get();
  if (!record.exists || record.get("kind") !== "vendor_offer") return null;
  const offerFor = String(record.get("offerFor") ?? "");
  const [invite, tenant] = await Promise.all([
    offerFor ? db.doc(`vendorInvites/${offerFor}`).get() : null,
    db.doc(`tenants/${String(record.get("tenantId") ?? "")}`).get(),
  ]);
  if (invite?.get("signedUpTenantId")) return null;
  const studioName = String(tenant.get("brandName") ?? "").trim() || String(tenant.get("businessName") ?? "").trim() || String(tenant.get("name") ?? "").trim();
  return { summary: VENDOR_OFFER_SUMMARY, studioName };
}

/**
 * A studio's or a partner's code on a signup link (`/auth/register?code=`):
 * whose it is, so the page can say "half price for 12 months" before the
 * account exists (Conor, 2026-10-14: every code is 50% off). Checkout decides
 * for itself (functions/src/saas/stripe.ts referredBy); a code that isn't a
 * live referral code says nothing.
 */
export async function signupReferralFor(db: Firestore, code: string): Promise<{ referrerName: string } | null> {
  const normalized = code.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-Z0-9]{4,20}$/.test(normalized)) return null;
  const record = await db.doc(`saasReferralCodes/${normalized}`).get();
  if (!record.exists || record.get("kind") === "vendor_offer") return null;
  const partnerId = record.get("partnerId");
  if (typeof partnerId === "string" && partnerId) {
    const partner = await db.doc(`saasPartners/${partnerId}`).get();
    if (!partner.exists || partner.get("active") === false) return null;
    return { referrerName: String(partner.get("business") || partner.get("name") || "").trim() };
  }
  const tenantId = record.get("tenantId");
  if (typeof tenantId !== "string" || !tenantId) return null;
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  if (!tenant.exists || tenant.get("archivedAt")) return null;
  return { referrerName: String(tenant.get("brandName") ?? "").trim() || String(tenant.get("businessName") ?? "").trim() || String(tenant.get("name") ?? "").trim() };
}
