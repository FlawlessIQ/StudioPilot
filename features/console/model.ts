/**
 * The Console's row shapes and labels, for the browser (docs/console.md).
 *
 * The rows are written by functions/src/console/rollup.ts; the constants
 * below are copies of functions/src/console/model.ts, compared value for value
 * by tests/console-engines.test.ts. Labels only — every judgement (health,
 * lifecycle, MRR) is made on the server and read here as data.
 */

import { planCards } from "@/config/saas-plans";

export const SETUP_KEYS = ["inquiries", "availability", "packages", "agreement", "questionnaire", "insurance"] as const;
export type SetupKey = (typeof SETUP_KEYS)[number];

export const SETUP_LABELS: Record<SetupKey, string> = {
  inquiries: "Inquiries reach StudioCue",
  availability: "Consultation hours",
  packages: "Packages",
  agreement: "How clients sign",
  questionnaire: "Details form",
  insurance: "Insurance certificates",
};

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

export const PLAN_LABELS: Record<string, string> = {
  studio: "Studio",
  multi_brand: "Multi-Brand",
};

/**
 * The published prices (config/saas-plans.ts), which the pricing page,
 * billing settings and Stripe's prices all agree with. Read from there rather
 * than copied: a copy here said $250 for a month after the price changed.
 */
export const PLAN_LIST_PRICE_CENTS: Record<string, { monthly: number; yearly: number }> = Object.fromEntries(
  planCards.map((plan) => [plan.key, { monthly: plan.monthlyCents, yearly: plan.yearlyCents }]),
);

export type HealthWeightKey =
  | "paymentFailed"
  | "noActivity"
  | "activityDrop"
  | "setupStalled"
  | "trialEndingUnready"
  | "integrationDegraded"
  | "deadLetters"
  | "openFeedback";

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

export type Tone = "ok" | "warn" | "bad" | "info" | "accent" | "neutral";

export const SUBSCRIPTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  trialing: { label: "Trialing", tone: "info" },
  active: { label: "Active", tone: "ok" },
  past_due: { label: "Past due", tone: "bad" },
  unpaid: { label: "Unpaid", tone: "bad" },
  paused: { label: "Paused", tone: "warn" },
  cancelled: { label: "Canceled", tone: "neutral" },
  incomplete: { label: "No card yet", tone: "warn" },
};

export const LIFECYCLE_TONES: Record<LifecycleStage, Tone> = {
  signed_up: "warn",
  setting_up: "info",
  stalled: "warn",
  activated: "accent",
  paying: "ok",
  at_risk: "bad",
  churned: "neutral",
  suspended: "bad",
};

export type DiscountSummary = {
  code: string | null;
  couponId: string | null;
  percentOff: number | null;
  amountOffCents: number | null;
  duration: "once" | "repeating" | "forever";
  durationMonths: number | null;
  endsAt: string | null;
};

export type HealthReason = { key: HealthWeightKey; label: string; points: number };

/** A `consoleStudios` row (functions/src/console/summary.ts). */
export type ConsoleStudio = {
  id: string;
  tenantId: string;
  name: string;
  legalName: string | null;
  slug: string | null;
  timezone: string | null;
  createdAt: string | null;
  ownerUid: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  plan: string | null;
  cadence: "monthly" | "yearly" | null;
  subscriptionStatus: string | null;
  comped: boolean;
  compEndsAt: string | null;
  compReason: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingMoment: { kind: "trial_ends" | "renews" | "cancels" | "comp_ends" | "ended" | "none"; at: string | null };
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  discount: DiscountSummary | null;
  mrrCents: number;
  potentialMrrCents: number;
  lastPaymentFailedAt: string | null;
  suspended: boolean;
  suspensionReason: string | null;
  setup: Record<SetupKey, boolean>;
  setupDone: number;
  jobs: { total: number; active: number; booked: number; leads: number; closed: number; firstAt: string | null; lastAt: string | null };
  seats: { internal: number; max: number | null; crew: number; clients: number };
  aiActionsMonth: number;
  aiActionsLimit: number | null;
  emails30d: number;
  emailsFailed30d: number;
  events30d: number;
  eventsPrior30d: number;
  lastActiveAt: string | null;
  lastSignInAt: string | null;
  integrations: { provider: string; status: string }[];
  degradedIntegrations: number;
  deadLetters: number;
  openFeedback: number;
  openTasks: number;
  lifecycle: LifecycleStage;
  health: { score: number; band: "good" | "fair" | "poor" | "none"; reasons: HealthReason[] };
  tags?: string[];
  removed: boolean;
  refreshedAt: string;
};

export type PersonType = "admin" | "studio" | "client" | "crew" | "none";

export const PERSON_TYPE_LABELS: Record<PersonType, string> = {
  admin: "Console admin",
  studio: "Studio",
  client: "Client",
  crew: "Crew",
  none: "No workspace",
};

/** A `consolePeople` row (functions/src/console/rollup.ts). */
export type ConsolePerson = {
  id: string;
  uid: string;
  name: string | null;
  email: string | null;
  search: string;
  type: PersonType;
  consoleRole: string | null;
  emailVerified: boolean;
  disabled: boolean;
  providers: string[];
  createdAt: string | null;
  lastSignInAt: string | null;
  lastActiveAt: string | null;
  memberships: { tenantId: string; tenantName: string; role: string; status: string }[];
  studioCount: number;
  removed: boolean;
  refreshedAt: string;
};

export const ROLE_LABELS: Record<string, string> = {
  studio_owner: "Owner",
  studio_admin: "Admin",
  studio_coordinator: "Coordinator",
  staff_photographer: "Photographer",
  staff_videographer: "Videographer",
  subcontractor: "Crew",
  client: "Client",
};

export const PROVIDER_LABELS: Record<string, string> = {
  password: "Email",
  "google.com": "Google",
  "apple.com": "Apple",
  phone: "Phone",
};
