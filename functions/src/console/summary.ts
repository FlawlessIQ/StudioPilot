import {
  DEFAULT_HEALTH_WEIGHTS,
  SETUP_KEYS,
  healthScore,
  lifecycleStage,
  monthlyRecurringCents,
  nextBillingMoment,
  potentialMonthlyCents,
  type DiscountSummary,
  type HealthWeightKey,
  type SetupKey,
} from "./model.js";

/**
 * Everything the rollup read about one studio, before any judgement.
 * rollup.ts fills it; buildStudioSummary turns it into the row. Kept as plain
 * data so the judgement is testable without Firestore.
 */
export type StudioRaw = {
  tenantId: string;
  tenant: Record<string, unknown>;
  subscription: Record<string, unknown> | null;
  owner: { uid: string; name: string | null; email: string | null } | null;
  members: { internal: number; crew: number; clients: number };
  setup: Record<SetupKey, boolean>;
  jobs: { total: number; active: number; booked: number; leads: number; closed: number; firstAt: string | null; lastAt: string | null };
  aiActionsMonth: number;
  emails30d: number;
  emailsFailed30d: number;
  events30d: number;
  eventsPrior30d: number;
  lastActiveAt: string | null;
  lastSignInAt: string | null;
  integrations: { provider: string; status: string }[];
  deadLetters: number;
  openFeedback: number;
  openTasks: number;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function discountFrom(value: unknown): DiscountSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const duration = record.duration === "once" || record.duration === "repeating" || record.duration === "forever"
    ? record.duration
    : null;
  if (!duration) return null;
  return {
    code: text(record.code),
    couponId: text(record.couponId),
    percentOff: number(record.percentOff),
    amountOffCents: number(record.amountOffCents),
    duration,
    durationMonths: number(record.durationMonths),
    endsAt: text(record.endsAt),
  };
}

const HEALTHY_INTEGRATION = new Set(["connected", "healthy", "active"]);

export function buildStudioSummary(
  raw: StudioRaw,
  now: Date,
  weights: Record<HealthWeightKey, number> = DEFAULT_HEALTH_WEIGHTS,
) {
  const tenant = raw.tenant;
  const sub = raw.subscription ?? {};
  const cadence = sub.cadence === "yearly" ? "yearly" : sub.cadence === "monthly" ? "monthly" : null;
  const comped = sub.comped === true;
  const suspended = text(tenant.status) === "suspended" || Boolean(text(sub.suspendedAt));
  const subscription = {
    plan: text(sub.plan) ?? text(tenant.subscriptionPlan),
    cadence: cadence ?? (raw.subscription ? "monthly" : null),
    status: text(sub.status),
    comped,
    compEndsAt: text(sub.compEndsAt),
    unitAmountCents: number(sub.unitAmountCents),
    discount: discountFrom(sub.discount),
    suspended,
  } as const;
  // A trial's period end is its trial end (resolveSubscriptionPeriod); the
  // tenant's own trialEndAt is the fallback from before Checkout ran.
  const trialEndsAt = subscription.status === "trialing"
    ? (text(sub.currentPeriodEnd) ?? text(tenant.trialEndAt))
    : null;
  const setupDone = SETUP_KEYS.filter((key) => raw.setup[key]).length;
  const degraded = raw.integrations.filter((item) => !HEALTHY_INTEGRATION.has(item.status) && item.status !== "disconnected").length;
  const signals = {
    subscription,
    trialEndsAt,
    tenantCreatedAt: text(tenant.createdAt),
    setupDone,
    jobsTotal: raw.jobs.total,
    activity: {
      events30d: raw.events30d,
      eventsPrior30d: raw.eventsPrior30d,
      lastActiveAt: raw.lastActiveAt,
    },
    degradedIntegrations: degraded,
    deadLetters: raw.deadLetters,
    openFeedback: raw.openFeedback,
  };
  const health = healthScore(signals, now, weights);
  const lifecycle = lifecycleStage(signals, health.score, now);
  const moment = nextBillingMoment({
    status: subscription.status,
    comped,
    compEndsAt: subscription.compEndsAt,
    trialEndsAt: signals.trialEndsAt,
    currentPeriodEnd: text(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
  });
  const entitlements = (sub.entitlements ?? {}) as Record<string, unknown>;
  const name =
    text(tenant.brandName) ?? text(tenant.businessName) ?? text(tenant.legalName) ?? text(tenant.name) ?? "Unnamed studio";

  return {
    id: raw.tenantId,
    tenantId: raw.tenantId,
    name,
    nameLower: name.toLowerCase(),
    legalName: text(tenant.legalName),
    slug: text(tenant.publicSlug) ?? text(tenant.slug),
    timezone: text(tenant.timezone),
    createdAt: text(tenant.createdAt),
    ownerUid: raw.owner?.uid ?? text(tenant.createdBy),
    ownerName: raw.owner?.name ?? null,
    ownerEmail: raw.owner?.email ?? null,
    plan: subscription.plan,
    cadence: subscription.cadence,
    subscriptionStatus: subscription.status,
    comped,
    compEndsAt: subscription.compEndsAt,
    compReason: text(sub.compReason),
    trialEndsAt: signals.trialEndsAt,
    currentPeriodEnd: text(sub.currentPeriodEnd),
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
    billingMoment: moment,
    stripeCustomerId: text(sub.stripeCustomerId),
    stripeSubscriptionId: text(sub.stripeSubscriptionId),
    discount: subscription.discount,
    mrrCents: monthlyRecurringCents(subscription, now),
    potentialMrrCents: potentialMonthlyCents(subscription),
    lastPaymentFailedAt: text(sub.lastPaymentFailedAt),
    suspended,
    suspensionReason: text(tenant.suspensionReason),
    setup: raw.setup,
    setupDone,
    jobs: raw.jobs,
    seats: {
      internal: raw.members.internal,
      max: number(entitlements.maxInternalUsers),
      crew: raw.members.crew,
      clients: raw.members.clients,
    },
    aiActionsMonth: raw.aiActionsMonth,
    aiActionsLimit: number(entitlements.aiActionsMonthly),
    emails30d: raw.emails30d,
    emailsFailed30d: raw.emailsFailed30d,
    events30d: raw.events30d,
    eventsPrior30d: raw.eventsPrior30d,
    lastActiveAt: raw.lastActiveAt,
    lastSignInAt: raw.lastSignInAt,
    integrations: raw.integrations,
    degradedIntegrations: degraded,
    deadLetters: raw.deadLetters,
    openFeedback: raw.openFeedback,
    openTasks: raw.openTasks,
    lifecycle,
    health,
    removed: false,
    refreshedAt: now.toISOString(),
  };
}

export type StudioSummary = ReturnType<typeof buildStudioSummary>;
