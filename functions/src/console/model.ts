/**
 * The Console's summary records and the deterministic engines that fill them
 * (docs/console.md). Pure: no I/O, so tests/console-engines.test.ts can pin
 * every rule.
 *
 * One summary row per studio (`consoleStudios/{tenantId}`) and per person
 * (`consolePeople/{uid}`) exists because a table needs one document per row.
 * Firestore can't join tenants to subscriptions to memberships to projects in
 * the browser, and a page that tried would make a few hundred reads to draw
 * ten rows. The rollup (rollup.ts) gathers once and writes the row; the
 * Console only ever reads rows.
 */

export const SETUP_KEYS = [
  "inquiries",
  "availability",
  "packages",
  "agreement",
  "questionnaire",
  "insurance",
] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

export const LIFECYCLE_STAGES = [
  "signed_up",
  "setting_up",
  "stalled",
  "activated",
  "paying",
  "at_risk",
  "churned",
  "suspended",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export const LIFECYCLE_LABELS: Record<LifecycleStage, string> = {
  signed_up: "Signed up",
  setting_up: "Setting up",
  stalled: "Stalled",
  activated: "Activated",
  paying: "Paying",
  at_risk: "At risk",
  churned: "Churned",
  suspended: "Suspended",
};

export type HealthBand = "good" | "fair" | "poor" | "none";

export type HealthReason = { key: HealthWeightKey; label: string; points: number };

export type HealthWeightKey =
  | "paymentFailed"
  | "noActivity"
  | "activityDrop"
  | "setupStalled"
  | "trialEndingUnready"
  | "integrationDegraded"
  | "deadLetters"
  | "openFeedback";

/** Points each signal costs. Editable in Console settings (consoleSettings/health). */
export const DEFAULT_HEALTH_WEIGHTS: Record<HealthWeightKey, number> = {
  paymentFailed: 30,
  noActivity: 20,
  activityDrop: 15,
  setupStalled: 15,
  trialEndingUnready: 10,
  integrationDegraded: 10,
  deadLetters: 5,
  openFeedback: 5,
};

export const HEALTH_WEIGHT_LABELS: Record<HealthWeightKey, string> = {
  paymentFailed: "Payment failed or past due",
  noActivity: "No activity in 14 days",
  activityDrop: "Activity down 40% or more against the prior 30 days",
  setupStalled: "Setup stalled during the trial",
  trialEndingUnready: "Trial ends within 3 days with setup unfinished",
  integrationDegraded: "Each integration in error (up to 2)",
  deadLetters: "Each failed job (up to 3)",
  openFeedback: "Each unanswered feedback item (up to 2)",
};

/**
 * List prices in cents, by plan and cadence (docs/onboarding-billing-plan-
 * 2026-09-07.md). Used for MRR only when the subscription carries no
 * `unitAmountCents` from Stripe — studios on an older price keep the amount
 * Stripe actually charges them.
 */
export const PLAN_LIST_PRICE_CENTS: Record<string, { monthly: number; yearly: number }> = {
  studio: { monthly: 25_000, yearly: 250_000 },
  multi_brand: { monthly: 39_900, yearly: 399_000 },
};

export const PLAN_LABELS: Record<string, string> = {
  studio: "Studio",
  multi_brand: "Multi-Brand",
};

export type DiscountSummary = {
  code: string | null;
  couponId: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: "once" | "repeating" | "forever";
  durationMonths: number | null;
  /** When the discount stops applying, if it does. */
  endsAt: string | null;
};

export type SubscriptionFacts = {
  plan: string | null;
  cadence: "monthly" | "yearly" | null;
  status: string | null;
  comped: boolean;
  compEndsAt: string | null;
  unitAmountCents: number | null;
  discount: DiscountSummary | null;
  suspended: boolean;
};

/** The discount is still taking money off at `now`. */
export function discountActive(discount: DiscountSummary | null, now: Date): boolean {
  if (!discount) return false;
  if (!discount.endsAt) return true;
  return Date.parse(discount.endsAt) > now.getTime();
}

/** One period's price, after an active discount. */
export function discountedAmount(amountCents: number, discount: DiscountSummary | null, now: Date): number {
  if (!discountActive(discount, now) || !discount) return amountCents;
  if (discount.percentOff) return Math.max(0, Math.round(amountCents * (1 - discount.percentOff / 100)));
  if (discount.amountOffCents) return Math.max(0, amountCents - discount.amountOffCents);
  return amountCents;
}

export function listPriceCents(plan: string | null, cadence: "monthly" | "yearly" | null): number | null {
  if (!plan || !cadence) return null;
  return PLAN_LIST_PRICE_CENTS[plan]?.[cadence] ?? null;
}

/**
 * Monthly recurring revenue in cents.
 *
 * Only a paying subscription counts: a trial, a comp, a past-due account and a
 * suspended one all contribute nothing. Past due is deliberately excluded — it
 * is revenue at risk, not revenue — and the Studios page shows it separately.
 * A yearly price is spread over twelve months.
 */
export function monthlyRecurringCents(facts: SubscriptionFacts, now: Date): number {
  if (facts.comped || facts.suspended || facts.status !== "active") return 0;
  const period = facts.unitAmountCents ?? listPriceCents(facts.plan, facts.cadence);
  if (period === null) return 0;
  const charged = discountedAmount(period, facts.discount, now);
  return facts.cadence === "yearly" ? Math.round(charged / 12) : charged;
}

/** What the studio would pay each month at its plan's price, for trials. */
export function potentialMonthlyCents(facts: SubscriptionFacts): number {
  const period = facts.unitAmountCents ?? listPriceCents(facts.plan, facts.cadence);
  if (period === null) return 0;
  return facts.cadence === "yearly" ? Math.round(period / 12) : period;
}

export type ActivityFacts = {
  /** Audit events by the studio's own people, last 30 days. */
  events30d: number;
  /** The same, for the 30 days before that. */
  eventsPrior30d: number;
  lastActiveAt: string | null;
};

export type StudioSignals = {
  subscription: SubscriptionFacts;
  trialEndsAt: string | null;
  tenantCreatedAt: string | null;
  setupDone: number;
  jobsTotal: number;
  activity: ActivityFacts;
  degradedIntegrations: number;
  deadLetters: number;
  openFeedback: number;
};

const DAY = 86_400_000;

function daysSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? (now.getTime() - at) / DAY : null;
}

function daysUntil(iso: string | null, now: Date): number | null {
  const since = daysSince(iso, now);
  return since === null ? null : -since;
}

/**
 * How healthy the account is, out of 100, and why.
 *
 * Starts at 100 and loses the points of each signal that applies. Every
 * deduction is returned with its reason, because a number nobody can explain is
 * one nobody acts on. Deterministic; no AI.
 */
export function healthScore(
  signals: StudioSignals,
  now: Date,
  weights: Record<HealthWeightKey, number> = DEFAULT_HEALTH_WEIGHTS,
): { score: number; band: HealthBand; reasons: HealthReason[] } {
  const status = signals.subscription.status;
  if (signals.subscription.suspended || status === "cancelled" || status === "incomplete")
    return { score: 0, band: "none", reasons: [] };
  const reasons: HealthReason[] = [];
  const add = (key: HealthWeightKey, label: string, multiple = 1) => {
    const points = weights[key] * multiple;
    if (points > 0) reasons.push({ key, label, points });
  };

  if (status === "past_due" || status === "paused") add("paymentFailed", "Payment failed or past due");

  const idle = daysSince(signals.activity.lastActiveAt ?? signals.tenantCreatedAt, now);
  if (signals.activity.events30d === 0 && idle !== null && idle >= 14) {
    add("noActivity", "No activity in 14 days");
  } else if (
    signals.activity.eventsPrior30d >= 10 &&
    signals.activity.events30d <= signals.activity.eventsPrior30d * 0.6
  ) {
    const drop = Math.round((1 - signals.activity.events30d / signals.activity.eventsPrior30d) * 100);
    add("activityDrop", `Activity down ${drop}% against the prior 30 days`);
  }

  if (status === "trialing") {
    const age = daysSince(signals.tenantCreatedAt, now);
    if (signals.setupDone < 3 && age !== null && age >= 5)
      add("setupStalled", `Setup at ${signals.setupDone} of 6 after ${Math.floor(age)} days`);
    const left = daysUntil(signals.trialEndsAt, now);
    if (left !== null && left >= 0 && left <= 3 && signals.setupDone < 4)
      add("trialEndingUnready", "Trial ends within 3 days with setup unfinished");
  }

  const degraded = Math.min(signals.degradedIntegrations, 2);
  if (degraded) add("integrationDegraded", `${degraded} integration${degraded === 1 ? "" : "s"} in error`, degraded);
  const dead = Math.min(signals.deadLetters, 3);
  if (dead) add("deadLetters", `${signals.deadLetters} failed job${signals.deadLetters === 1 ? "" : "s"}`, dead);
  const feedback = Math.min(signals.openFeedback, 2);
  if (feedback)
    add("openFeedback", `${signals.openFeedback} feedback item${signals.openFeedback === 1 ? "" : "s"} unanswered`, feedback);

  const score = Math.max(0, 100 - reasons.reduce((sum, reason) => sum + reason.points, 0));
  return { score, band: score >= 75 ? "good" : score >= 50 ? "fair" : "poor", reasons };
}

/**
 * Where the studio is in its life with StudioCue.
 *
 * Order matters: a suspended studio is suspended whatever else is true, and a
 * past-due one is at risk even though it once paid.
 */
export function lifecycleStage(signals: StudioSignals, healthScoreValue: number, now: Date): LifecycleStage {
  const status = signals.subscription.status;
  if (signals.subscription.suspended) return "suspended";
  if (status === "cancelled") return "churned";
  if (status === "incomplete" || status === null) return "signed_up";
  if (status === "past_due" || status === "paused") return "at_risk";
  if (status === "trialing") {
    const idle = daysSince(signals.activity.lastActiveAt ?? signals.tenantCreatedAt, now);
    if (signals.jobsTotal > 0) return healthScoreValue < 50 ? "at_risk" : "activated";
    if (idle !== null && idle >= 5) return "stalled";
    return "setting_up";
  }
  return healthScoreValue < 50 ? "at_risk" : "paying";
}

/** The trial or renewal date a person would look for, by status. */
export function nextBillingMoment(input: {
  status: string | null;
  comped: boolean;
  compEndsAt: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}): { kind: "trial_ends" | "renews" | "cancels" | "comp_ends" | "ended" | "none"; at: string | null } {
  if (input.comped) return input.compEndsAt ? { kind: "comp_ends", at: input.compEndsAt } : { kind: "none", at: null };
  if (input.status === "trialing") return { kind: "trial_ends", at: input.trialEndsAt ?? input.currentPeriodEnd };
  if (input.status === "cancelled") return { kind: "ended", at: input.currentPeriodEnd };
  if (input.status === "incomplete" || !input.currentPeriodEnd) return { kind: "none", at: null };
  return { kind: input.cancelAtPeriodEnd ? "cancels" : "renews", at: input.currentPeriodEnd };
}
