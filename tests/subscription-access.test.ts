import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CANCELLED_READ_ONLY_DAYS,
  PAST_DUE_GRACE_DAYS,
  accessAllowsViewing,
  accessAllowsWork,
  subscriptionAccess,
} from "../features/subscriptions/access.ts";
import { billingNotice } from "../features/subscriptions/billing-notice.ts";
import {
  requireActiveSubscription,
  requireEntitlement,
} from "../functions/src/saas/entitlement-guard.ts";
import { staleStripeEvent } from "../functions/src/saas/stripe-event-order.ts";
import { normalizeStatus, writeSubscriptionFromStripe } from "../functions/src/saas/stripe.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();
const daysAhead = (days: number) => new Date(NOW + days * DAY).toISOString();

// ── the rule ──

const MARKER = "// ── mirrored below ──";
const below = (path: string) => {
  const source = readFileSync(path, "utf8");
  return source.slice(source.indexOf(MARKER));
};

test("functions decides access by the same rule as the app", () => {
  assert.equal(
    below("functions/src/saas/subscription-access.ts"),
    below("features/subscriptions/access.ts"),
    "the server and the app would disagree about what a studio may do",
  );
});

test("a trial and a paid subscription have full access", () => {
  assert.equal(subscriptionAccess({ status: "trialing" }, NOW).level, "full");
  assert.equal(subscriptionAccess({ status: "active" }, NOW).level, "full");
});

test("a failed payment keeps full access for the grace period, then turns read-only", () => {
  assert.equal(PAST_DUE_GRACE_DAYS, 7, "the Terms promise seven days");
  const fresh = subscriptionAccess({ status: "past_due", pastDueSince: daysAgo(2) }, NOW);
  assert.equal(fresh.level, "grace");
  assert.equal(fresh.graceEndsAt, daysAhead(5));
  assert.equal(subscriptionAccess({ status: "past_due", pastDueSince: daysAgo(6.9) }, NOW).level, "grace");
  assert.equal(subscriptionAccess({ status: "past_due", pastDueSince: daysAgo(7) }, NOW).level, "read_only");
  assert.equal(subscriptionAccess({ status: "past_due", pastDueSince: daysAgo(30) }, NOW).level, "read_only");
});

test("a past-due record from before pastDueSince falls back to the failure stamp, then the last write", () => {
  assert.equal(
    subscriptionAccess({ status: "past_due", lastPaymentFailedAt: daysAgo(1), updatedAt: daysAgo(20) }, NOW).level,
    "grace",
  );
  assert.equal(subscriptionAccess({ status: "past_due", updatedAt: daysAgo(10) }, NOW).level, "read_only");
  assert.equal(subscriptionAccess({ status: "past_due" }, NOW).level, "read_only", "no date at all is not a free pass");
});

test("unpaid and paused are read-only", () => {
  assert.equal(subscriptionAccess({ status: "unpaid" }, NOW).level, "read_only");
  assert.equal(subscriptionAccess({ status: "paused" }, NOW).level, "read_only");
});

test("a cancelled studio can read and export for 30 days, then closes", () => {
  assert.equal(CANCELLED_READ_ONLY_DAYS, 30, "the Terms promise a 30-day export window");
  const recent = subscriptionAccess({ status: "cancelled", cancelledAt: daysAgo(3) }, NOW);
  assert.equal(recent.level, "read_only");
  assert.equal(recent.closesAt, daysAhead(27));
  assert.equal(subscriptionAccess({ status: "cancelled", cancelledAt: daysAgo(31) }, NOW).level, "closed");
  assert.equal(subscriptionAccess({ status: "cancelled", updatedAt: daysAgo(10) }, NOW).level, "read_only");
});

test("no subscription, checkout never finished, suspended, or an unknown status is closed", () => {
  assert.equal(subscriptionAccess(null, NOW).level, "closed");
  assert.equal(subscriptionAccess({ status: "incomplete" }, NOW).level, "closed");
  assert.equal(subscriptionAccess({ status: "something_new" }, NOW).level, "closed");
  assert.equal(subscriptionAccess({ status: "active", suspendedAt: daysAgo(1) }, NOW).level, "closed");
});

test("the trial end is carried for the trial reminder", () => {
  assert.equal(subscriptionAccess({ status: "trialing", currentPeriodEnd: daysAhead(2) }, NOW).trialEndsAt, daysAhead(2));
  assert.equal(subscriptionAccess({ status: "trialing", trialEndAt: daysAhead(1), currentPeriodEnd: daysAhead(9) }, NOW).trialEndsAt, daysAhead(1));
});

test("work is allowed in full and grace; viewing in everything but closed", () => {
  assert.deepEqual(
    (["full", "grace", "read_only", "closed"] as const).map((level) => [accessAllowsWork({ level }), accessAllowsViewing({ level })]),
    [[true, true], [true, true], [false, true], [false, false]],
  );
});

// ── the server guard ──

function db(subscription: Record<string, unknown> | null) {
  return {
    doc: () => ({
      get: async () => ({
        exists: subscription !== null,
        get: (field: string) =>
          field.split(".").reduce<unknown>(
            (value, key) => (typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined),
            subscription ?? undefined,
          ),
      }),
    }),
  } as never;
}

test("studio commands run in grace and are refused as read-only after it", async () => {
  await requireActiveSubscription(db({ status: "past_due", pastDueSince: new Date(Date.now() - 2 * DAY).toISOString() }), "t");
  await assert.rejects(
    () => requireActiveSubscription(db({ status: "past_due", pastDueSince: new Date(Date.now() - 9 * DAY).toISOString() }), "t"),
    /SUBSCRIPTION_READ_ONLY/,
  );
  await assert.rejects(() => requireActiveSubscription(db({ status: "unpaid" }), "t"), /SUBSCRIPTION_READ_ONLY/);
  await assert.rejects(() => requireActiveSubscription(db({ status: "incomplete" }), "t"), /ACTIVE_SUBSCRIPTION_REQUIRED/);
  await assert.rejects(() => requireActiveSubscription(db(null), "t"), /ACTIVE_SUBSCRIPTION_REQUIRED/);
  await assert.rejects(() => requireActiveSubscription(db({ status: "active", suspendedAt: "2026-10-01T00:00:00Z" }), "t"), /STUDIO_SUSPENDED/);
});

test("a capability follows the same rule before checking the plan", async () => {
  const entitlements = { coiEnabled: true };
  await requireEntitlement(db({ status: "past_due", pastDueSince: new Date().toISOString(), entitlements }), "t", "coiEnabled");
  await assert.rejects(
    () => requireEntitlement(db({ status: "unpaid", entitlements }), "t", "coiEnabled"),
    /SUBSCRIPTION_READ_ONLY/,
  );
});

test("AI quota uses the shared rule, not its own status list", () => {
  const usage = readFileSync("functions/src/saas/usage.ts", "utf8");
  assert.match(usage, /subscriptionAccess\(subscriptionAccessRecord\(subscription\)\)/);
  assert.doesNotMatch(usage, /\["trialing","active"\]/);
});

// ── Stripe ──

test("unpaid is its own state and incomplete_expired is a cancellation, not a fresh start", () => {
  assert.equal(normalizeStatus("unpaid"), "unpaid");
  assert.equal(normalizeStatus("incomplete_expired"), "cancelled");
  assert.equal(normalizeStatus("canceled"), "cancelled");
  assert.equal(normalizeStatus("incomplete"), "incomplete");
});

test("a studio that has had a Stripe subscription never gets a second free trial", () => {
  const stripe = readFileSync("functions/src/saas/stripe.ts", "utf8");
  assert.match(
    stripe,
    /const firstCheckout =\s*!comped &&\s*!overrideLive &&\s*normalizeStatus\(existingStatus\) === "incomplete" &&\s*!subscriptionId;/,
  );
  assert.match(stripe, /\["trialing", "active", "past_due", "unpaid", "paused"\]\.includes\(\s*String\(existingStatus\)/);
});

function snapshot(data: Record<string, unknown> | null) {
  return {
    exists: data !== null,
    get: (field: string) => (data ? data[field] : undefined),
  } as never;
}

async function written(current: Record<string, unknown> | null, object: Record<string, unknown>, deleted = false, eventCreated?: number) {
  let data: Record<string, unknown> = {};
  const writer = { set: (_reference: unknown, value: Record<string, unknown>) => (data = value) };
  const reference = { firestore: {} } as never;
  await writeSubscriptionFromStripe(writer, reference, snapshot(current), "tenant-a", object, deleted, "2026-10-20T12:00:00.000Z", eventCreated);
  return data;
}

test("the first past-due write starts the grace clock and later ones keep it", async () => {
  const first = await written({ status: "active" }, { id: "sub_1", status: "past_due" });
  assert.equal(first.pastDueSince, "2026-10-20T12:00:00.000Z");
  const again = await written({ status: "past_due", pastDueSince: "2026-10-18T00:00:00.000Z" }, { id: "sub_1", status: "past_due" });
  assert.equal(again.pastDueSince, "2026-10-18T00:00:00.000Z");
  const recovered = await written({ status: "past_due", pastDueSince: "2026-10-18T00:00:00.000Z" }, { id: "sub_1", status: "active" });
  assert.equal(recovered.pastDueSince, null, "a later failure gets a fresh grace period");
});

test("a cancellation is stamped once and the event time is remembered", async () => {
  const cancelled = await written({ status: "active" }, { id: "sub_1", status: "canceled" }, true, 1_790_000_000);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledAt, "2026-10-20T12:00:00.000Z");
  assert.equal(cancelled.lastStripeEventCreated, 1_790_000_000);
  const confirm = await written({ status: "cancelled", cancelledAt: "2026-10-01T00:00:00.000Z" }, { id: "sub_1", status: "canceled" });
  assert.equal(confirm.cancelledAt, "2026-10-01T00:00:00.000Z");
  assert.equal("lastStripeEventCreated" in confirm, false, "confirmCheckout carries no event time");
});

test("an event older than the last one applied is stale", () => {
  const base = { storedStatus: "active", storedSubscriptionId: "sub_1", eventSubscriptionId: "sub_1", eventStatus: "trialing", deleted: false };
  assert.equal(staleStripeEvent({ ...base, lastAppliedCreated: 200, eventCreated: 199 }), "older_than_applied");
  assert.equal(staleStripeEvent({ ...base, lastAppliedCreated: 200, eventCreated: 200 }), null, "same second applies");
  assert.equal(staleStripeEvent({ ...base, lastAppliedCreated: undefined, eventCreated: 1 }), null);
});

test("a cancelled subscription cannot be revived by a late update", () => {
  const cancelled = { lastAppliedCreated: undefined, eventCreated: 300, storedStatus: "cancelled", storedSubscriptionId: "sub_1" };
  assert.equal(
    staleStripeEvent({ ...cancelled, eventSubscriptionId: "sub_1", eventStatus: "trialing", deleted: false }),
    "subscription_already_cancelled",
  );
  assert.equal(staleStripeEvent({ ...cancelled, eventSubscriptionId: "sub_1", eventStatus: "canceled", deleted: false }), null);
  assert.equal(
    staleStripeEvent({ ...cancelled, eventSubscriptionId: "sub_2", eventStatus: "trialing", deleted: false }),
    null,
    "a returning studio's new subscription applies",
  );
});

test("the webhook checks order and writes in one transaction", () => {
  const stripe = readFileSync("functions/src/saas/stripe.ts", "utf8");
  const webhook = stripe.slice(stripe.indexOf("export const stripeWebhook"));
  assert.match(webhook, /db\.runTransaction\(async \(transaction\) =>/);
  assert.match(webhook, /staleStripeEvent\(\{/);
  assert.match(webhook, /status: "stale",\s*staleReason: stale,/);
  assert.match(webhook, /event\.created,\s*\);/);
});

// ── what the studio is told ──

test("the owner is told what to do and staff are told who can", () => {
  const grace = subscriptionAccess({ status: "past_due", pastDueSince: daysAgo(1) }, NOW);
  const owner = billingNotice(grace, true, NOW);
  const staff = billingNotice(grace, false, NOW);
  assert.equal(owner?.action, "manage");
  assert.equal(staff?.action, "ask_owner");
  assert.match(staff?.body ?? "", /Ask the studio owner/);
  assert.equal(owner?.dismissible, false);
});

test("read-only and ended subscriptions say what still works", () => {
  const readOnly = billingNotice(subscriptionAccess({ status: "unpaid" }, NOW), true, NOW);
  assert.match(readOnly?.title ?? "", /read-only/);
  assert.match(readOnly?.body ?? "", /export your data/);
  const ended = billingNotice(subscriptionAccess({ status: "cancelled", cancelledAt: daysAgo(2) }, NOW), true, NOW);
  assert.match(ended?.title ?? "", /has ended/);
  assert.match(ended?.body ?? "", /export your data until/);
});

test("the trial reminder shows to the owner in the last three days only", () => {
  const soon = subscriptionAccess({ status: "trialing", currentPeriodEnd: daysAhead(2) }, NOW);
  assert.equal(billingNotice(soon, true, NOW)?.dismissible, true);
  assert.equal(billingNotice(soon, false, NOW), null);
  assert.equal(billingNotice(subscriptionAccess({ status: "trialing", currentPeriodEnd: daysAhead(10) }, NOW), true, NOW), null);
  assert.equal(billingNotice(subscriptionAccess({ status: "active" }, NOW), true, NOW), null);
});

// ── where it is wired ──

test("every studio member gets the billing state from the bootstrap route", () => {
  const route = readFileSync("app/api/workspace/bootstrap/route.ts", "utf8");
  assert.match(route, /subscriptionAccess\(subscription\.data\(\)\)/);
  const context = readFileSync("features/auth/workspace-context.tsx", "utf8");
  assert.match(context, /const readsSubscription = area === "studio" && membership\.role === "studio_owner";/);
  assert.match(context, /subscriptionAccess: billing,/);
});

test("the shell gates only a closed studio and shows the banner otherwise", () => {
  const shell = readFileSync("components/layout/app-shell.tsx", "utf8");
  assert.match(shell, /billingAccess\.level === "closed"/);
  assert.match(shell, /<BillingBanner access=\{billingAccess\} isOwner=\{isOwner\} \/>/);
  assert.doesNotMatch(shell, /subscriptionGrantsAccess/);
});
