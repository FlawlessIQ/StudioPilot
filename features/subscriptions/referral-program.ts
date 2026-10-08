/**
 * The referral program (Conor, 2026-10-08). It replaces the Partners feature
 * of 2026-10-07.
 *
 * - **Every studio has its own code.**
 * - **A studio that signs up with it** gets the 14-day trial, then its first
 *   year of the Studio plan at $75/month billed yearly ($900), or $100/month
 *   billed monthly. After that year it pays the list price.
 * - **The studio whose code it was** earns $100 of StudioCue credit, once,
 *   for each one still paying three months after its first payment (Conor,
 *   2026-10-08: "make sure its clear that its once off and will be paid after
 *   the referral is live for 3 months"). A sign-up that cancels in its trial,
 *   or inside those three months, earns nothing.
 * - **The vendors on a studio's booked jobs** (DJs, planners, florists, hair
 *   and makeup) are invited automatically with that studio's code, once each.
 *
 * Pure. Mirrored at functions/src/saas/referral-program.ts, which cannot import
 * from features/; tests/referral-program.test.ts fails on a drift.
 */

export const REFERRAL_CREDIT_CENTS = 10_000;
/** How long a referred studio has to have been paying before its referrer's credit. */
export const REFERRAL_LIVE_MONTHS = 3;

/** The Studio plan for a referred studio's first year. */
export const OFFER_YEARLY_CENTS = 90_000;
export const OFFER_MONTHLY_CENTS = 10_000;
export const OFFER_MONTHS = 12;

/** A code as typed or carried on a link: letters and digits, upper case. */
export function normalizeReferralCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  return /^[A-Z0-9]{4,20}$/.test(code) ? code : null;
}

const FILLER = /\b(PHOTOGRAPHY|PHOTO|PHOTOS|STUDIOS?|FILMS?|LLC|INC|CO|THE|AND)\b/g;

/** The code a studio is first offered, from its name: "GR Productions" → "GRPRODUCTIONS". */
export function referralCodeStem(studioName: string): string {
  const upper = studioName.toUpperCase().replace(/&/g, " ");
  const trimmed = upper.replace(FILLER, " ").replace(/[^A-Z0-9]/g, "");
  const whole = upper.replace(/[^A-Z0-9]/g, "");
  const stem = (trimmed.length >= 4 ? trimmed : whole).slice(0, 14);
  return stem.length >= 4 ? stem : `${stem}STUDIO`.slice(0, 14);
}

/** When a referral's credit is due: three months after the referred studio first paid. */
export function creditDueAt(paidAtIso: string): string {
  const due = new Date(paidAtIso);
  const day = due.getUTCDate();
  due.setUTCMonth(due.getUTCMonth() + REFERRAL_LIVE_MONTHS, 1);
  // Nov 30 + 3 months is Feb 28, not March 2.
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(day, lastDay));
  return due.toISOString();
}

export type ReferralRecord = {
  tenantId: string;
  referrerTenantId: string;
  paidAt?: string | null;
  creditedAt?: string | null;
  forfeitedAt?: string | null;
};

/**
 * What the daily settlement does with one referral.
 *
 * - **"credit"**: it has been paying for three months, is still paying, and
 *   hasn't been credited.
 * - **"forfeit"**: the studio canceled before its credit was due.
 * - **"hold"**: still in its trial, inside its three months, or behind on
 *   payment. Looked at again tomorrow.
 * - **"done"**: already credited or forfeited. Each referral is credited once.
 */
export function settlement(
  referral: ReferralRecord,
  referredStatus: string,
  nowIso: string,
): "credit" | "forfeit" | "hold" | "done" {
  if (referral.creditedAt || referral.forfeitedAt) return "done";
  if (["cancelled", "canceled", "incomplete_expired"].includes(referredStatus)) return "forfeit";
  if (!referral.paidAt) return "hold";
  if (creditDueAt(referral.paidAt) > nowIso) return "hold";
  return referredStatus === "active" ? "credit" : "hold";
}

/** Vendor types invited to try StudioCue. Venues, insurers and clients' own contacts are not vendors. */
export const INVITED_VENDOR_TYPES = [
  "planner",
  "florist",
  "dj",
  "band",
  "videographer",
  "hair_makeup",
  "caterer",
  "transportation",
  "other",
] as const;

/** Job states from booked on: a vendor on an inquiry that never books is not invited. */
export const BOOKED_JOB_STATES = [
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
] as const;

/** "$900 for the first year" style copy, shared by the studio's card and the invite. */
export const OFFER_SUMMARY =
  "14 days free, then $75/month billed yearly for the first year ($900), or $100/month billed monthly for the first 12 months";
