import type { Firestore } from "firebase-admin/firestore";

/**
 * Per-studio feature access (docs/console.md, "Feature access").
 *
 * The gates the product actually reads live on `tenantFeatures/{tenantId}`
 * (features/contracts/rollout.ts and its function-side twins). The Console
 * keeps the rollout decision on `featureFlags/{key}` — off, some studios, or
 * every studio — and writes the result onto each studio's tenantFeatures, so
 * no reader changes and "on for every studio" also reaches studios created
 * later (the rollup re-applies it every 15 minutes).
 *
 * Only features in this catalog can be managed. The old flag collection let an
 * admin create any key, and nothing in the product ever read one: a switch
 * that looked real and did nothing. A feature is added here in the same
 * change that adds the code that reads it.
 */
export const CONSOLE_FEATURES = [
  {
    key: "nativeContractSigning",
    label: "StudioCue contracts",
    description: "StudioCue writes each client's contract from the studio's agreement and they sign in their portal. Held per studio until counsel has reviewed the consent and certificate wording.",
    requires: null,
  },
  {
    key: "combinedAgreement",
    label: "Combined agreement",
    description: "Terms and coverage go out as one agreement with two signatures. Needs StudioCue contracts.",
    requires: "nativeContractSigning",
  },
] as const;

export type ConsoleFeatureKey = (typeof CONSOLE_FEATURES)[number]["key"];
export const CONSOLE_FEATURE_KEYS = CONSOLE_FEATURES.map((feature) => feature.key) as ConsoleFeatureKey[];
export type FeatureScope = "off" | "some" | "all";

export function isConsoleFeature(value: string): value is ConsoleFeatureKey {
  return (CONSOLE_FEATURE_KEYS as string[]).includes(value);
}

/** Whether one studio has the feature under a rollout decision. Pure. */
export function featureOnFor(scope: FeatureScope, tenantIds: readonly string[], tenantId: string): boolean {
  return scope === "all" || (scope === "some" && tenantIds.includes(tenantId));
}

/**
 * The rollout decision for a feature. A feature nobody has managed yet in the
 * Console has no decision: its per-studio switches were set by hand, and are
 * imported as "some studios" the first time it changes here, so turning the
 * Console on never switches anything off.
 */
export async function featureDecision(db: Firestore, key: ConsoleFeatureKey) {
  const flag = await db.doc(`featureFlags/${key}`).get();
  if (flag.exists && flag.get("managed") === true) {
    const scope = flag.get("scope");
    return {
      managed: true as const,
      scope: (scope === "all" || scope === "some" ? scope : "off") as FeatureScope,
      tenantIds: (Array.isArray(flag.get("tenantIds")) ? flag.get("tenantIds") : []) as string[],
    };
  }
  const handSet = await db.collection("tenantFeatures").where(key, "==", true).select().get();
  return { managed: false as const, scope: (handSet.empty ? "off" : "some") as FeatureScope, tenantIds: handSet.docs.map((doc) => doc.id) };
}

/** Write the decision onto every studio whose switch disagrees with it. */
export async function applyFeature(db: Firestore, key: ConsoleFeatureKey, scope: FeatureScope, tenantIds: readonly string[], now: string) {
  const [tenants, current] = await Promise.all([
    db.collection("tenants").select().get(),
    db.collection("tenantFeatures").select(key).get(),
  ]);
  const state = new Map(current.docs.map((doc) => [doc.id, doc.get(key) === true]));
  let changed = 0;
  let batch = db.batch();
  let pending = 0;
  for (const tenant of tenants.docs) {
    const want = featureOnFor(scope, tenantIds, tenant.id);
    if ((state.get(tenant.id) ?? false) === want) continue;
    batch.set(db.doc(`tenantFeatures/${tenant.id}`), { tenantId: tenant.id, [key]: want, updatedAt: now }, { merge: true });
    changed += 1;
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return changed;
}

/** Re-apply every managed decision. Called by the rollup so new studios catch up. */
export async function applyManagedFeatures(db: Firestore, now: string) {
  let changed = 0;
  for (const key of CONSOLE_FEATURE_KEYS) {
    const decision = await featureDecision(db, key);
    if (decision.managed) changed += await applyFeature(db, key, decision.scope, decision.tenantIds, now);
  }
  return changed;
}
