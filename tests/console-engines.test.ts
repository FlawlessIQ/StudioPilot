import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as server from "../functions/src/console/model.ts";
import { buildStudioSummary, discountFrom, type StudioRaw } from "../functions/src/console/summary.ts";
import { CONSOLE_CAPABILITIES, roleCan, roleFromClaims } from "../functions/src/console/roles.ts";
import * as browserRoles from "../features/console/roles.ts";
import * as browser from "../features/console/model.ts";
import { planCards } from "../config/saas-plans.ts";

/**
 * The Console's judgements (docs/console.md): health, lifecycle, MRR, the
 * next billing moment, and who may do what. Server-side and deterministic,
 * so each rule is pinned here; the browser only reads the results.
 */

const NOW = new Date("2026-10-01T12:00:00.000Z");
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString();

const facts = (overrides: Partial<server.SubscriptionFacts> = {}): server.SubscriptionFacts => ({
  plan: "studio",
  cadence: "monthly",
  status: "active",
  comped: false,
  compEndsAt: null,
  unitAmountCents: null,
  discount: null,
  suspended: false,
  ...overrides,
});

const signals = (overrides: Partial<server.StudioSignals> = {}): server.StudioSignals => ({
  subscription: facts(),
  trialEndsAt: null,
  tenantCreatedAt: day(-60),
  setupDone: 6,
  jobsTotal: 10,
  activity: { events30d: 30, eventsPrior30d: 30, lastActiveAt: day(-1) },
  degradedIntegrations: 0,
  deadLetters: 0,
  openFeedback: 0,
  ...overrides,
});

test("MRR counts only paying subscriptions, spreads yearly over twelve and applies a live discount", () => {
  assert.equal(server.monthlyRecurringCents(facts(), NOW), 15_000);
  assert.equal(server.monthlyRecurringCents(facts({ cadence: "yearly" }), NOW), Math.round(150_000 / 12));
  assert.equal(server.monthlyRecurringCents(facts({ plan: "multi_brand" }), NOW), 29_900);
  // Stripe's own amount wins over the list price: a studio still on the
  // legacy $250 price keeps paying it.
  assert.equal(server.monthlyRecurringCents(facts({ unitAmountCents: 25_000 }), NOW), 25_000);
  for (const status of ["trialing", "past_due", "paused", "cancelled", "incomplete"])
    assert.equal(server.monthlyRecurringCents(facts({ status }), NOW), 0, `${status} is not revenue`);
  assert.equal(server.monthlyRecurringCents(facts({ comped: true }), NOW), 0);
  assert.equal(server.monthlyRecurringCents(facts({ suspended: true }), NOW), 0);
  const twenty = { code: "FALL20", couponId: "c", percentOff: 20, amountOffCents: null, duration: "repeating" as const, durationMonths: 3, endsAt: day(30) };
  assert.equal(server.monthlyRecurringCents(facts({ discount: twenty }), NOW), 12_000);
  assert.equal(server.monthlyRecurringCents(facts({ discount: { ...twenty, endsAt: day(-1) } }), NOW), 15_000, "an ended discount takes nothing off");
  const fifty = { ...twenty, percentOff: null, amountOffCents: 5_000, duration: "forever" as const, endsAt: null };
  assert.equal(server.monthlyRecurringCents(facts({ discount: fifty }), NOW), 10_000);
  assert.equal(server.monthlyRecurringCents(facts({ discount: { ...fifty, amountOffCents: 99_999 } }), NOW), 0, "never negative");
});

test("a trial's potential MRR is its plan's monthly price", () => {
  assert.equal(server.potentialMonthlyCents(facts({ status: "trialing" })), 15_000);
  assert.equal(server.potentialMonthlyCents(facts({ status: "trialing", cadence: "yearly" })), Math.round(150_000 / 12));
});

test("health starts at 100 and every deduction says why", () => {
  assert.deepEqual(server.healthScore(signals(), NOW), { score: 100, band: "good", reasons: [] });
  const pastDue = server.healthScore(signals({ subscription: facts({ status: "past_due" }) }), NOW);
  assert.equal(pastDue.score, 70);
  assert.equal(pastDue.reasons[0]?.key, "paymentFailed");
  const quiet = server.healthScore(signals({ activity: { events30d: 0, eventsPrior30d: 20, lastActiveAt: day(-20) } }), NOW);
  assert.deepEqual(quiet.reasons.map((reason) => reason.key), ["noActivity"], "no activity, not also a drop");
  const drop = server.healthScore(signals({ activity: { events30d: 6, eventsPrior30d: 20, lastActiveAt: day(-1) } }), NOW);
  assert.match(drop.reasons[0]!.label, /down 70%/);
  // Small numbers aren't a trend.
  assert.equal(server.healthScore(signals({ activity: { events30d: 1, eventsPrior30d: 5, lastActiveAt: day(-1) } }), NOW).score, 100);
  // Capped multiples.
  const noisy = server.healthScore(signals({ deadLetters: 9, openFeedback: 5, degradedIntegrations: 4 }), NOW);
  assert.equal(noisy.score, 100 - 15 - 10 - 20);
  assert.equal(noisy.band, "fair");
});

test("trial signals: stalled setup and an unready trial about to end", () => {
  const stalled = server.healthScore(
    signals({ subscription: facts({ status: "trialing" }), setupDone: 1, tenantCreatedAt: day(-6), trialEndsAt: day(2), jobsTotal: 0 }),
    NOW,
  );
  assert.deepEqual(stalled.reasons.map((reason) => reason.key), ["setupStalled", "trialEndingUnready"]);
  assert.equal(stalled.score, 75);
});

test("no live subscription is not scored", () => {
  for (const status of ["cancelled", "incomplete"])
    assert.equal(server.healthScore(signals({ subscription: facts({ status }) }), NOW).band, "none");
  assert.equal(server.healthScore(signals({ subscription: facts({ suspended: true }) }), NOW).band, "none");
});

test("weights from Console settings change the score", () => {
  const weights = { ...server.DEFAULT_HEALTH_WEIGHTS, paymentFailed: 60 };
  assert.equal(server.healthScore(signals({ subscription: facts({ status: "past_due" }) }), NOW, weights).score, 40);
});

test("lifecycle stage, in order of precedence", () => {
  const stage = (overrides: Partial<server.StudioSignals>, score = 100) => server.lifecycleStage(signals(overrides), score, NOW);
  assert.equal(stage({ subscription: facts({ suspended: true, status: "past_due" }) }), "suspended");
  assert.equal(stage({ subscription: facts({ status: "cancelled" }) }), "churned");
  assert.equal(stage({ subscription: facts({ status: "incomplete" }) }), "signed_up");
  assert.equal(stage({ subscription: facts({ status: "past_due" }) }), "at_risk");
  assert.equal(stage({ subscription: facts({ status: "trialing" }), jobsTotal: 2 }), "activated");
  assert.equal(stage({ subscription: facts({ status: "trialing" }), jobsTotal: 2 }, 40), "at_risk");
  assert.equal(stage({ subscription: facts({ status: "trialing" }), jobsTotal: 0, activity: { events30d: 0, eventsPrior30d: 0, lastActiveAt: day(-6) } }), "stalled");
  assert.equal(stage({ subscription: facts({ status: "trialing" }), jobsTotal: 0, activity: { events30d: 2, eventsPrior30d: 0, lastActiveAt: day(-1) } }), "setting_up");
  assert.equal(stage({}), "paying");
  assert.equal(stage({}, 30), "at_risk");
});

test("the billing moment a person looks for, by status", () => {
  const base = { status: "active", comped: false, compEndsAt: null, trialEndsAt: null, currentPeriodEnd: day(20), cancelAtPeriodEnd: false };
  assert.deepEqual(server.nextBillingMoment(base), { kind: "renews", at: day(20) });
  assert.deepEqual(server.nextBillingMoment({ ...base, cancelAtPeriodEnd: true }), { kind: "cancels", at: day(20) });
  assert.deepEqual(server.nextBillingMoment({ ...base, status: "trialing", trialEndsAt: day(3) }), { kind: "trial_ends", at: day(3) });
  assert.deepEqual(server.nextBillingMoment({ ...base, comped: true, compEndsAt: day(90) }), { kind: "comp_ends", at: day(90) });
  assert.deepEqual(server.nextBillingMoment({ ...base, comped: true }), { kind: "none", at: null });
  assert.deepEqual(server.nextBillingMoment({ ...base, status: "incomplete", currentPeriodEnd: null }), { kind: "none", at: null });
});

const raw = (overrides: Partial<StudioRaw> = {}): StudioRaw => ({
  tenantId: "tenant_a",
  tenant: { brandName: "Juniper & Oak", businessName: "Juniper LLC", createdAt: day(-10), timezone: "America/New_York", publicSlug: "juniper" },
  subscription: { plan: "studio", cadence: "monthly", status: "trialing", currentPeriodEnd: day(4), entitlements: { maxInternalUsers: 3, aiActionsMonthly: 2500 } },
  owner: { uid: "u1", name: "Maya Ortiz", email: "maya@example.test" },
  members: { internal: 2, crew: 1, clients: 3 },
  setup: { inquiries: true, availability: true, packages: true, agreement: false, questionnaire: false, insurance: false },
  jobs: { total: 3, active: 3, booked: 1, leads: 2, closed: 0, firstAt: day(-8), lastAt: day(-1) },
  aiActionsMonth: 40,
  emails30d: 12,
  emailsFailed30d: 0,
  events30d: 25,
  eventsPrior30d: 0,
  lastActiveAt: day(-0.1),
  lastSignInAt: day(-0.2),
  integrations: [{ provider: "zoom", status: "connected" }],
  deadLetters: 0,
  openFeedback: 0,
  openTasks: 1,
  ...overrides,
});

test("a studio's row: name, plan, trial, setup and judgement in one place", () => {
  const row = buildStudioSummary(raw(), NOW);
  assert.equal(row.name, "Juniper & Oak", "the brand name a studio goes by");
  assert.equal(row.trialEndsAt, day(4));
  assert.deepEqual(row.billingMoment, { kind: "trial_ends", at: day(4) });
  assert.equal(row.setupDone, 3);
  assert.equal(row.mrrCents, 0);
  assert.equal(row.potentialMrrCents, 15_000);
  assert.equal(row.lifecycle, "activated");
  assert.equal(row.seats.max, 3);
  assert.equal(row.removed, false);
  // Tags belong to the Console, not the rollup: a rebuilt row must not wipe them.
  assert.equal("tags" in row, false);
});

test("suspension shows on the row from either record", () => {
  assert.equal(buildStudioSummary(raw({ tenant: { ...raw().tenant, status: "suspended" } }), NOW).lifecycle, "suspended");
  assert.equal(buildStudioSummary(raw({ subscription: { ...raw().subscription!, suspendedAt: day(-1) } }), NOW).suspended, true);
});

test("an integration in error counts against health; a disconnected one doesn't", () => {
  const row = buildStudioSummary(raw({ integrations: [{ provider: "zoom", status: "error" }, { provider: "gcal", status: "disconnected" }] }), NOW);
  assert.equal(row.degradedIntegrations, 1);
});

test("a discount summary is read defensively", () => {
  assert.equal(discountFrom(null), null);
  assert.equal(discountFrom({ duration: "weekly" }), null);
  assert.deepEqual(discountFrom({ code: "FALL20", percentOff: 20, duration: "repeating", durationMonths: 3 }), {
    code: "FALL20",
    couponId: null,
    percentOff: 20,
    amountOffCents: null,
    duration: "repeating",
    durationMonths: 3,
    endsAt: null,
  });
});

test("the browser's labels and prices are the server's", () => {
  assert.deepEqual(browser.LIFECYCLE_LABELS, server.LIFECYCLE_LABELS);
  assert.deepEqual([...browser.LIFECYCLE_STAGES], [...server.LIFECYCLE_STAGES]);
  assert.deepEqual(browser.PLAN_LABELS, server.PLAN_LABELS);
  assert.deepEqual(browser.PLAN_LIST_PRICE_CENTS, server.PLAN_LIST_PRICE_CENTS);
  // Both are the published prices. The server copy said $250 for a month
  // after Stripe and the pricing page moved to $150.
  for (const plan of planCards)
    assert.deepEqual(server.PLAN_LIST_PRICE_CENTS[plan.key], { monthly: plan.monthlyCents, yearly: plan.yearlyCents }, plan.key);
  assert.deepEqual(Object.keys(server.PLAN_LIST_PRICE_CENTS).sort(), planCards.map((plan) => plan.key).sort());
  assert.deepEqual(browser.DEFAULT_HEALTH_WEIGHTS, server.DEFAULT_HEALTH_WEIGHTS);
  assert.deepEqual(browser.HEALTH_WEIGHT_LABELS, server.HEALTH_WEIGHT_LABELS);
  assert.deepEqual([...browser.SETUP_KEYS], [...server.SETUP_KEYS]);
});

test("Console roles: the browser copy matches the authority below its header", () => {
  const body = (path: string) => readFileSync(path, "utf8").split("*/").slice(1).join("*/");
  assert.equal(body("features/console/roles.ts"), body("functions/src/console/roles.ts"));
  assert.deepEqual(browserRoles.CONSOLE_CAPABILITIES, CONSOLE_CAPABILITIES);
});

test("Console roles: the claim gates, the role decides", () => {
  assert.equal(roleFromClaims(null), null);
  assert.equal(roleFromClaims({ platformRole: "owner" }), null, "a role without the platform admin claim is nothing");
  assert.equal(roleFromClaims({ platformAdmin: true }), "owner", "admins from before roles keep owner");
  assert.equal(roleFromClaims({ platformAdmin: true, platformRole: "support" }), "support");
  assert.equal(roleFromClaims({ platformAdmin: true, platformRole: "superuser" }), "owner");
  assert.equal(roleCan("viewer", "console.read"), true);
  assert.equal(roleCan("viewer", "crm.write"), false);
  assert.equal(roleCan("support", "inbox.write"), true);
  assert.equal(roleCan("support", "billing.write"), false);
  assert.equal(roleCan("operator", "billing.write"), true);
  assert.equal(roleCan("operator", "studios.suspend"), false);
  assert.equal(roleCan("operator", "admins.manage"), false);
  assert.equal(roleCan("owner", "deletion.approve"), true);
  assert.equal(roleCan(null, "console.read"), false);
});
