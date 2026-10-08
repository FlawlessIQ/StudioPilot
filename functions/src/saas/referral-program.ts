/**
 * The referral program (Conor, 2026-10-08). It replaces the Partners feature
 * of 2026-10-07.
 *
 * - **Every studio has its own code.**
 * - **A studio that signs up with it** gets the 14-day trial, then its first
 *   year of the Studio plan at $75/month billed yearly ($900), or $100/month
 *   billed monthly. After that year it pays the list price.
 * - **The studio whose code it was** earns $50 of StudioCue credit for each
 *   one that pays. Credits are settled once a quarter for the quarter before,
 *   and only for studios still paying when it's settled, so a sign-up that
 *   cancels in its trial, or straight after its first payment, earns nothing.
 * - **The vendors on a studio's booked jobs** (DJs, planners, florists, hair
 *   and makeup) are invited automatically with that studio's code, once each.
 *
 * Pure. A mirror of features/subscriptions/referral-program.ts (functions/ cannot import
 * from features/); tests/referral-program.test.ts fails on a drift.
 */

export const REFERRAL_CREDIT_CENTS = 5_000;

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

/** The calendar quarter an instant falls in: "2026-Q4". */
export function quarterKey(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** The quarter before the one `nowIso` falls in, with its bounds (UTC). */
export function previousQuarter(nowIso: string): { key: string; startIso: string; endIso: string } {
  const now = new Date(nowIso);
  const thisStart = Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1);
  const start = new Date(thisStart);
  start.setUTCMonth(start.getUTCMonth() - 3);
  return { key: quarterKey(start.toISOString()), startIso: start.toISOString(), endIso: new Date(thisStart).toISOString() };
}

export type ReferralRecord = {
  tenantId: string;
  referrerTenantId: string;
  paidAt?: string | null;
  creditedAt?: string | null;
  forfeitedAt?: string | null;
};

/**
 * What the quarterly settlement does with one referral.
 *
 * - **"credit"**: it paid before this quarter began, the studio is still
 *   paying, and it hasn't been credited.
 * - **"forfeit"**: the studio has since canceled.
 * - **"hold"**: not yet paid, behind on payment, or paid inside the quarter
 *   now running. A held referral is looked at again next quarter.
 * - **"done"**: already settled.
 */
export function settlement(
  referral: ReferralRecord,
  referredStatus: string,
  settleBeforeIso: string,
): "credit" | "forfeit" | "hold" | "done" {
  if (referral.creditedAt || referral.forfeitedAt) return "done";
  if (!referral.paidAt) return "hold";
  if (referral.paidAt >= settleBeforeIso) return "hold";
  if (referredStatus === "active") return "credit";
  if (["cancelled", "canceled", "incomplete_expired"].includes(referredStatus)) return "forfeit";
  return "hold";
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
