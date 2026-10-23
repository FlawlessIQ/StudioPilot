/**
 * When a whole studio may not be deleted (audit 2026-10-22).
 *
 * The worker used to refuse only a studio with a Stripe subscription id and a
 * live status, checked once. A studio the team comped locally — `comped: true`,
 * `active`, no Stripe subscription at all (saas/onboarding.ts), the reference
 * studio among them — passed straight through, and nothing looked again once
 * the run had started.
 *
 * So one rule, read fresh at every gate: the Console's approval, the worker's
 * start, and immediately before each irreversible step (tenant-deletion.ts).
 * It refuses unless the studio's billing has clearly ended:
 *
 *   - unreadable, missing or self-contradicting subscription record → refused.
 *     Every studio is created with one in the same transaction as its tenant,
 *     so "none" is not "nothing to bill": it is something we cannot see.
 *   - comped, in any comp mode (local or a Stripe coupon) → refused. A comp is
 *     the team's decision that the studio keeps running; ending it is too.
 *   - trialing, active, past_due, unpaid, paused, or any status this file does
 *     not know → refused. Stripe still bills, retries or can resume all of them.
 *   - `incomplete` with a Stripe subscription behind it → refused: Stripe is
 *     still waiting on a first payment.
 *
 * Allowed: `cancelled` / `canceled` / `incomplete_expired`, and `incomplete`
 * with no Stripe subscription (a Checkout never finished, or a comp ended —
 * there is nothing to bill).
 *
 * Pure: no Firebase, so tests/tenant-deletion-refusal.test.ts runs it as is.
 */

export const ENDED_SUBSCRIPTION_STATUSES: readonly string[] = ["cancelled", "canceled", "incomplete_expired"];
/** Statuses Stripe still bills, retries or can resume. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["trialing", "active", "past_due", "unpaid", "paused"];

export type TenantDeletionRefusalCode =
  | "SUBSCRIPTION_UNREADABLE"
  | "SUBSCRIPTION_MISSING"
  | "SUBSCRIPTION_INCONSISTENT"
  | "STUDIO_COMPED"
  | "SUBSCRIPTION_LIVE";

export type TenantDeletionRefusal = { code: TenantDeletionRefusalCode; reason: string };

export type TenantDeletionState = {
  tenantId: string;
  /**
   * `subscriptions/{tenantId}` as read just now: its data, `null` when there
   * is no document, or `"unreadable"` when the read itself failed.
   */
  subscription: Record<string, unknown> | null | "unreadable";
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function tenantDeletionRefusal(state: TenantDeletionState): TenantDeletionRefusal | null {
  const { subscription } = state;
  if (subscription === "unreadable")
    return { code: "SUBSCRIPTION_UNREADABLE", reason: "The studio's subscription could not be read, so its billing can't be confirmed ended." };
  if (subscription === null || typeof subscription !== "object")
    return { code: "SUBSCRIPTION_MISSING", reason: "The studio has no subscription record, so its billing can't be confirmed ended." };
  if (!state.tenantId || text(subscription.tenantId) !== state.tenantId)
    return { code: "SUBSCRIPTION_INCONSISTENT", reason: "The subscription record names a different studio." };

  // Any comp, before anything else: a comped studio reads `active` with no
  // Stripe ids, which is exactly what slipped through before.
  const comped = subscription.comped;
  if (comped === true)
    return { code: "STUDIO_COMPED", reason: "The studio is comped. End the comp in the Console first." };
  if (comped !== undefined && comped !== null && comped !== false)
    return { code: "SUBSCRIPTION_INCONSISTENT", reason: "The subscription's comp flag is not true or false." };
  if (text(subscription.compMode))
    return { code: "SUBSCRIPTION_INCONSISTENT", reason: "The subscription has a comp mode but is not marked comped." };

  const status = text(subscription.status);
  const stripeSubscriptionId = text(subscription.stripeSubscriptionId);
  if (ENDED_SUBSCRIPTION_STATUSES.includes(status)) return null;
  if (status === "incomplete")
    return stripeSubscriptionId
      ? { code: "SUBSCRIPTION_LIVE", reason: "Stripe is still waiting on the studio's first payment. Cancel the subscription in Stripe first." }
      : null;
  if (LIVE_SUBSCRIPTION_STATUSES.includes(status))
    return { code: "SUBSCRIPTION_LIVE", reason: `The studio's subscription is ${status.replace(/_/g, " ")}. Cancel it in Stripe first.` };
  return { code: "SUBSCRIPTION_INCONSISTENT", reason: `The subscription's status (${status || "none"}) is not one that has clearly ended.` };
}

/**
 * Collections the sweep never touches, though their documents carry this
 * studio's `tenantId`. The sweep is discovery (every collection,
 * `tenantId == id`), so a record that names the closing studio but belongs to
 * someone else has to be named here or it goes with it.
 *
 * This operation's own proof:
 *   - `auditEvents`: kept, personal fields stripped (runbook A6.6).
 *   - `deletionRequests`: this operation's record.
 *   - `webhookEvents`: provider idempotency, hashes not payloads.
 *
 * Another studio's, or a referral partner's:
 *   - `saasReferrals/{referred tenant}`: `tenantId` is the studio that was
 *     referred, but the record is the *referrer's* credit or a partner's
 *     commission (saas/referrals.ts; the Console tallies partner payouts from
 *     it). Deleting the referred studio must not erase what someone else earned.
 *   - `vendorInvites/{sha256(email)}`: `tenantId` is the studio whose job
 *     brought the vendor in, but the record is the platform's once-ever
 *     invitation to an outside address, with its unsubscribe token
 *     (saas/vendor-invites.ts). Gone, the vendor could be invited again by the
 *     next studio, and their unsubscribe link would stop working.
 *   - `saasReferralCodes` of `kind: "vendor_offer"`: see `keptDocument`.
 *
 * The platform's own records about the studio, not the studio's data:
 *   - `saasInvoices`: StudioCue's revenue ledger (stripe.ts recordInvoice).
 *     Our billing records are kept for 7 years (runbook A6.6).
 *   - `saasAttribution`: where the studio came from (Console → Sources).
 *   - `saasLeads`: the sales pipeline; `tenantId` is set when a lead signs up.
 *   - `supportAccess`: who on the team opened the studio's workspace, and
 *     why — a security record, kept like the audit trail.
 *   - `consoleStudios`, `consoleNotes`, `consoleTasks`, `consoleLifecycleEvents`:
 *     the Console's row, the team's notes and tasks, and the churn history.
 *     The rollup marks the row `removed` once the tenant is gone (rollup.ts).
 *
 * Checked and safe without a listing (no `tenantId` field, so the sweep never
 * matches them): `saasReferralCredits` (referredTenantId / referrerTenantId),
 * `saasPartners`, `saasPartnerPayouts` (partnerId), `saasDiscounts`,
 * `consoleReplies`, `emailSuppressions` (keyed by address hash), `issues`
 * (`tenantIds`, an array). A referral this studio *made* is
 * `saasReferrals.referrerTenantId`, not `tenantId`, and is left alone too.
 */
export const TENANT_DELETION_KEPT: readonly string[] = [
  "auditEvents",
  "deletionRequests",
  "webhookEvents",
  "saasReferrals",
  "vendorInvites",
  "saasInvoices",
  "saasAttribution",
  "saasLeads",
  "supportAccess",
  "consoleStudios",
  "consoleNotes",
  "consoleTasks",
  "consoleLifecycleEvents",
];

/**
 * Deleted by name, at the very end, after every irreversible step.
 *
 * - `tenants/{id}` is the handle: while it exists a stopped run can resume.
 * - `subscriptions/{id}` is what `tenantDeletionRefusal` reads before each
 *   step. Swept with the rest, every later check would find "no subscription"
 *   and either refuse forever or — worse — be written to allow it.
 */
export const TENANT_DELETION_DEFERRED: readonly string[] = ["tenants", "subscriptions"];

/**
 * One document kept from a collection that is otherwise swept.
 *
 * `saasReferralCodes`: a studio's own code (`{ code, tenantId }`) goes with
 * it — left behind it would keep "referring" new studios to one that no longer
 * exists. A vendor offer code (`kind: "vendor_offer"`) names the inviting
 * studio as `tenantId` but was handed to the vendor (`offerFor`): it is the
 * vendor's discount, and stays.
 */
export function keptDocument(collection: string, data: Record<string, unknown>): boolean {
  if (collection === "saasReferralCodes") return data.kind === "vendor_offer";
  return false;
}

/** The sweep may take this collection's documents at all. */
export function tenantDeletionMaySweep(collection: string): boolean {
  return !TENANT_DELETION_KEPT.includes(collection) && !TENANT_DELETION_DEFERRED.includes(collection);
}
