import type { Firestore } from "firebase-admin/firestore";

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
 * full use of COI workflows and custom automations indefinitely. Trialing
 * and active are the states that may work; everything else — past_due,
 * paused, cancelled, incomplete — is refused.
 *
 * Reads the entitlement snapshot stored on the subscription rather than the
 * plan key, so a tenant keeps exactly what it was sold even if the published
 * ladder moves underneath it. That is what let the Solo migration retire a
 * plan without changing anyone's capacity.
 */
export async function requireEntitlement(
  db: Firestore,
  tenantId: string,
  capability: GuardedCapability,
): Promise<void> {
  const subscription = await db.doc(`subscriptions/${tenantId}`).get();
  if (
    !subscription.exists ||
    !["trialing", "active"].includes(String(subscription.get("status")))
  ) {
    throw new Error("ACTIVE_SUBSCRIPTION_REQUIRED");
  }
  if (subscription.get(`entitlements.${capability}`) !== true) {
    throw new Error(`ENTITLEMENT_REQUIRED:${capability}`);
  }
}
