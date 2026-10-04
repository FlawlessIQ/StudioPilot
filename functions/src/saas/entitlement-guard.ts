import type { Firestore } from "firebase-admin/firestore";
import {
  SUBSCRIPTION_ACCESS_FIELDS,
  accessAllowsWork,
  subscriptionAccess,
  type SubscriptionAccess,
  type SubscriptionAccessRecord,
} from "./subscription-access.js";

/**
 * Capabilities a plan can switch off.
 *
 * Deliberately not every flag in the entitlement table. `smsEnabled` gates
 * a send path that does not exist yet, `apiAccessEnabled` gates a public API
 * that does not exist yet, and `prioritySupportEnabled` is a response-time
 * promise rather than anything code can refuse. Listing those here would
 * produce guards that can never fire, which reads as enforcement and is
 * decoration. They belong here the day they have something to guard.
 */
export type GuardedCapability =
  | "coiEnabled"
  | "customWorkflowsEnabled"
  | "advancedReportingEnabled";

/**
 * Refuse work a tenant is not entitled to.
 *
 * `hasEntitlement` existed with no call sites: every boolean in the plan
 * table was defined, published on the pricing page, and enforced nowhere.
 * Only the four counters — seats, brands, subcontractors, AI actions — did
 * real work.
 *
 * The status check is the half that bites today. Outside AI quota, nothing
 * asked whether a tenant was still paying, so a cancelled subscription kept
 * full use of COI workflows and custom automations indefinitely. The access
 * rule (subscription-access.ts) decides: full access and grace may work;
 * read-only and closed are refused.
 *
 * Reads the entitlement snapshot stored on the subscription rather than the
 * plan key, so a tenant keeps exactly what it was sold even if the published
 * ladder moves underneath it. That is what let the Solo migration retire a
 * plan without changing anyone's capacity.
 */
/**
 * The subscription fields the access rule reads, from a snapshot. Field by
 * field rather than `data()`, so a snapshot that only offers `get` (tests,
 * transactions) reads the same.
 */
export function subscriptionAccessRecord(snapshot: {
  exists: boolean;
  get(field: string): unknown;
}): SubscriptionAccessRecord | null {
  if (!snapshot.exists) return null;
  return Object.fromEntries(
    SUBSCRIPTION_ACCESS_FIELDS.map((field) => [field, snapshot.get(field)]),
  ) as SubscriptionAccessRecord;
}

/** What the tenant may do now, from its subscription document. */
export async function readSubscriptionAccess(
  db: Firestore,
  tenantId: string,
): Promise<SubscriptionAccess> {
  return subscriptionAccess(
    subscriptionAccessRecord(await db.doc(`subscriptions/${tenantId}`).get()),
  );
}

/**
 * Refuse studio work unless the subscription allows it (subscription-access.ts):
 * a trial, a paid subscription, or a failed payment still inside its grace
 * period. Card-required onboarding means every tenant has a subscription, so
 * this is the gate that puts the whole studio product behind billing. Apply it
 * at the top of every studio command endpoint, after identity + membership
 * resolve. NOT for client/crew endpoints or the billing/onboarding commands.
 *
 * A read-only studio (past grace, unpaid, or recently cancelled) is refused
 * with its own code, so the app can say "read-only until billing is updated"
 * rather than "start your trial".
 */
export async function requireActiveSubscription(
  db: Firestore,
  tenantId: string,
): Promise<void> {
  const subscription = await db.doc(`subscriptions/${tenantId}`).get();
  // A suspended studio (Console → Suspend) is recorded here as well as on the
  // tenant, so this one read refuses it. Before, suspension wrote only
  // tenants.status, which nothing read: a "suspended" studio kept full access.
  if (subscription.exists && subscription.get("suspendedAt")) {
    throw new Error("STUDIO_SUSPENDED");
  }
  const access = subscriptionAccess(subscriptionAccessRecord(subscription));
  if (access.level === "read_only") throw new Error("SUBSCRIPTION_READ_ONLY");
  if (!accessAllowsWork(access)) throw new Error("ACTIVE_SUBSCRIPTION_REQUIRED");
}

export async function requireEntitlement(
  db: Firestore,
  tenantId: string,
  capability: GuardedCapability,
): Promise<void> {
  const subscription = await db.doc(`subscriptions/${tenantId}`).get();
  if (subscription.exists && subscription.get("suspendedAt")) {
    throw new Error("STUDIO_SUSPENDED");
  }
  const access = subscriptionAccess(subscriptionAccessRecord(subscription));
  if (access.level === "read_only") throw new Error("SUBSCRIPTION_READ_ONLY");
  if (!accessAllowsWork(access)) throw new Error("ACTIVE_SUBSCRIPTION_REQUIRED");
  if (subscription.get(`entitlements.${capability}`) !== true) {
    throw new Error(`ENTITLEMENT_REQUIRED:${capability}`);
  }
}
