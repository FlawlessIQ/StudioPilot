/**
 * Console → Grow → Vendors (docs/console.md, "Vendors"): the words and the
 * pure decisions the page draws with. The rows come from
 * functions/src/console/handlers/vendors.ts; the database is
 * functions/src/saas/platform-vendors.ts.
 */

export type VendorOfferState = "none" | "invited" | "offered" | "claimed" | "signed_up" | "opted_out";
export type VendorProspect = "vendor_plan" | "studio_plan" | "held";

export const OFFER_STATE_LABELS: Record<VendorOfferState, string> = {
  none: "Not contacted",
  invited: "Invited",
  offered: "Offered",
  claimed: "Code used",
  signed_up: "Signed up",
  opted_out: "Opted out",
};

export const PROSPECT_LABELS: Record<VendorProspect, string> = {
  vendor_plan: "Vendor plan",
  studio_plan: "Studio plan",
  held: "No journey yet",
};

export const SOURCE_LABELS: Record<string, string> = {
  couple: "Listed by a couple",
  client_form: "From a couple's form",
  studio: "Added by a studio",
  planner: "Added by a planner",
};

/** The partner type a vendor's kind suggests (Partners, partner-payouts.ts). */
export function partnerTypeFor(kind: string): "planner" | "dj" | "hair" | "makeup" | "other" {
  if (kind === "planner") return "planner";
  if (kind === "dj") return "dj";
  if (kind === "hair_makeup") return "makeup";
  return "other";
}

/** A partner code suggested from the business name: "Sound Wave DJs" → "SOUNDWAVEDJS". */
export function suggestedPartnerCode(company: string | null | undefined, contactName: string | null | undefined): string {
  const base = (company || contactName || "").toUpperCase().replace(/&/g, " ").replace(/\b(LLC|INC|CO|THE|AND)\b/g, " ").replace(/[^A-Z0-9]/g, "");
  return base.slice(0, 16);
}

/** Who a partner code makes sense for: a vendor-plan trade that already works with several studios is the obvious ask. */
export function partnerCandidate(row: { prospect: string; studiosSeen: number; offer: VendorOfferState }): boolean {
  return row.prospect === "vendor_plan" && row.offer !== "signed_up";
}
