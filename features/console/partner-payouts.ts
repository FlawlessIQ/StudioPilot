/**
 * Referral partners (Conor, 2026-10-12): planners, DJs, hair and makeup
 * artists who send photographers to StudioCue with their own code.
 *
 * - **The code** is made in the Console (Grow → Referrals → Partners) and works
 *   exactly like a studio's referral code: a photographer who signs up with it
 *   gets the referral offer for whichever plan they choose
 *   (features/subscriptions/referral-program.ts).
 * - **A referral counts** once that photographer has been paying for three
 *   months and still is: the same rule a studio's referral credit follows
 *   (`settlement`), so a sign-up that cancels in its trial earns nothing.
 * - **The partner earns $100 per referral that counts.** Past ten, every one
 *   is worth $200, the first ten included: "it gives them $200 for the first
 *   10 too once they reach the milestone".
 * - **It is paid by hand** (Venmo, Zelle, check) and recorded here, so the
 *   Console shows what is owed. Partners are not StudioCue customers, so there
 *   is no bill to credit.
 *
 * Pure: the Console page and the tests read it.
 */

export const PARTNER_RATE_CENTS = 10_000;
export const PARTNER_TOP_RATE_CENTS = 20_000;
/** More than this many referrals that count, and every one earns the top rate. */
export const PARTNER_TIER_AFTER = 10;

export const PARTNER_TYPES = ["planner", "dj", "hair", "makeup", "other"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  planner: "Planner",
  dj: "DJ",
  hair: "Hair",
  makeup: "Makeup",
  other: "Other",
};

export const PAYOUT_METHODS = ["venmo", "zelle", "paypal", "check", "bank", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = {
  venmo: "Venmo",
  zelle: "Zelle",
  paypal: "PayPal",
  check: "Check",
  bank: "Bank transfer",
  other: "Other",
};

/** `saasReferrals/{tenantId}`, as far as a partner's tally needs it. */
export type PartnerReferral = {
  partnerId?: string | null;
  status?: string | null;
  signedUpAt?: string | null;
  paidAt?: string | null;
  /** Set by the daily settlement once it has been paying for three months. */
  qualifiedAt?: string | null;
  forfeitedAt?: string | null;
};

export type PartnerPayout = { partnerId: string; amountCents: number };

export type ReferralStage = "trial" | "paying" | "counts" | "canceled";

export const REFERRAL_STAGE_LABELS: Record<ReferralStage, string> = {
  trial: "In trial",
  paying: "Paying, counts at 3 months",
  counts: "Counts",
  canceled: "Canceled, doesn't count",
};

export function referralStage(referral: PartnerReferral): ReferralStage {
  if (referral.qualifiedAt) return "counts";
  if (referral.forfeitedAt) return "canceled";
  if (referral.paidAt) return "paying";
  return "trial";
}

/** What one referral that counts is worth, given how many count. */
export function partnerRateCents(counted: number): number {
  return counted > PARTNER_TIER_AFTER ? PARTNER_TOP_RATE_CENTS : PARTNER_RATE_CENTS;
}

export type PartnerTally = {
  signedUp: number;
  inTrial: number;
  paying: number;
  counted: number;
  canceled: number;
  rateCents: number;
  earnedCents: number;
  paidCents: number;
  owedCents: number;
  /** Referrals that count still needed for the top rate, or 0 once there. */
  toTopRate: number;
};

/** One partner's referrals and payouts, added up. */
export function partnerTally(referrals: readonly PartnerReferral[], payouts: readonly PartnerPayout[]): PartnerTally {
  const stages = referrals.map(referralStage);
  const counted = stages.filter((stage) => stage === "counts").length;
  const rateCents = partnerRateCents(counted);
  const earnedCents = counted * rateCents;
  const paidCents = payouts.reduce((sum, payout) => sum + Math.max(0, Math.round(Number(payout.amountCents) || 0)), 0);
  return {
    signedUp: referrals.length,
    inTrial: stages.filter((stage) => stage === "trial").length,
    paying: stages.filter((stage) => stage === "paying").length,
    counted,
    canceled: stages.filter((stage) => stage === "canceled").length,
    rateCents,
    earnedCents,
    paidCents,
    owedCents: earnedCents - paidCents,
    toTopRate: Math.max(0, PARTNER_TIER_AFTER + 1 - counted),
  };
}

/** The link a partner shares: signup with their code applied (features/subscriptions/promotion-code.ts). */
export function partnerSignupLink(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/auth/register?code=${encodeURIComponent(code)}`;
}
