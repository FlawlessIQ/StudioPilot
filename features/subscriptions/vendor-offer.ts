import { tradeProfile, vendorTypeIsLive, vendorTypeLiveTrades } from "@/features/trades/trades";

/**
 * The vendor offer (docs/vendor-network-plan-2026-10-12.md, Phase 3; D1): a
 * vendor who worked a StudioCue studio's wedding gets the vendor plan at
 * half price: $50/month for the first 12 months, or $500 for the first year
 * (list $100 / $1,000; Conor, 2026-10-14: 50% off from every source), after the
 * 14-day trial. The writes, the coupon and checkout are the server's
 * (functions/src/saas/vendor-offer.ts); this is the pure part the share page
 * and the Subscription page read. tests/vendor-offer.test.ts keeps the two equal.
 */

export const VENDOR_OFFER_MONTHLY_CENTS = 5_000;
export const VENDOR_OFFER_YEARLY_CENTS = 50_000;
export const VENDOR_OFFER_MONTHS = 12;
export const VENDOR_OFFER_SUMMARY = "14 days free, then half price for your first 12 months: $50/month, or $500 for your first year";
/** The same, said about someone else: a referrer's card, the Console, a partner's file. */
export const VENDOR_OFFER_SUMMARY_THEIRS = "14 days free, then half price for their first 12 months: $50/month, or $500 for their first year";

export type VendorOfferAudience = "vendor" | "studio";

/** The vendor plan's offer, the Studio plan's referral price (a videographer), or none (no journey yet). */
export function vendorOfferAudience(vendorType: unknown): VendorOfferAudience | null {
  const type = typeof vendorType === "string" ? vendorType : "";
  if (!vendorTypeIsLive(type)) return null;
  const trades = vendorTypeLiveTrades(type);
  if (!trades.length) return null;
  if (trades.some((trade) => tradeProfile(trade).family === "photo")) return "studio";
  return trades.every((trade) => tradeProfile(trade).plans.includes("vendor")) ? "vendor" : null;
}

/** The signup the offer opens: the vendor's trade chosen, the vendor plan and their code. */
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

/** How a trade's offer reads on the share page: "Run your DJ bookings on StudioCue". */
export function vendorOfferHeadline(vendorType: unknown): string {
  const trades = vendorTypeLiveTrades(typeof vendorType === "string" ? vendorType : "");
  if (trades.length > 1) return "Run your hair and makeup bookings on StudioCue";
  switch (trades[0]) {
    case "dj":
      return "Run your DJ bookings on StudioCue";
    case "hair":
      return "Run your hair bookings on StudioCue";
    case "makeup":
      return "Run your makeup bookings on StudioCue";
    case "planner":
      return "Run your planning business on StudioCue";
    default:
      return "Run your bookings on StudioCue";
  }
}
