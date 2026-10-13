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
  if (!code || suppressed.exists || invite.get("offerClaimedTenantId")) return null;
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
