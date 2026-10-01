import { z } from "zod";
import { REASON_MIN, consoleHandler, fail } from "../command-kit.js";
import { CONSOLE_FEATURES, CONSOLE_FEATURE_KEYS, applyFeature, featureDecision, type ConsoleFeatureKey } from "../features.js";

const featureKey = z.string().refine((value): value is ConsoleFeatureKey => (CONSOLE_FEATURE_KEYS as string[]).includes(value), {
  message: "UNKNOWN_FEATURE",
});

async function save(
  db: FirebaseFirestore.Firestore,
  key: ConsoleFeatureKey,
  scope: "off" | "some" | "all",
  tenantIds: string[],
  uid: string,
  now: string,
) {
  const feature = CONSOLE_FEATURES.find((item) => item.key === key);
  await db.doc(`featureFlags/${key}`).set(
    {
      id: key,
      key,
      label: feature?.label ?? key,
      description: feature?.description ?? "",
      managed: true,
      scope,
      tenantIds: [...new Set(tenantIds)].sort(),
      // Kept so anything still reading the old shape sees the truth.
      enabled: scope !== "off",
      archivedAt: null,
      updatedAt: now,
      updatedBy: uid,
    },
    { merge: true },
  );
  return applyFeature(db, key, scope, tenantIds, now);
}

export const featureHandlers = {
  /** Off, some studios, or every studio. "All" reaches studios created later too. */
  setFeatureScope: consoleHandler({
    capability: "features.write",
    input: z.object({
      key: featureKey,
      scope: z.enum(["off", "some", "all"]),
      reason: z.string().trim().min(REASON_MIN).max(1000),
    }),
    async run({ db, identity, now }, input) {
      const key = input.key as ConsoleFeatureKey;
      const before = await featureDecision(db, key);
      // Going to "some" keeps whoever has it now; "off" and "all" keep the list
      // too, so switching back to "some" restores the same studios.
      const changed = await save(db, key, input.scope, before.tenantIds, identity.uid, now);
      return {
        result: { key, scope: input.scope, studiosChanged: changed },
        audit: { tenantId: null, entityType: "feature", entityId: key, before: { scope: before.scope }, after: { scope: input.scope, studiosChanged: changed }, reason: input.reason },
      };
    },
  }),

  /** One studio's switch. Moves an "off" feature to "some". */
  setStudioFeature: consoleHandler({
    capability: "features.write",
    input: z.object({ key: featureKey, tenantId: z.string().min(1).max(200), enabled: z.boolean() }),
    async run({ db, identity, now }, input) {
      const key = input.key as ConsoleFeatureKey;
      const tenant = await db.doc(`tenants/${input.tenantId}`).get();
      if (!tenant.exists) fail("TENANT_NOT_FOUND");
      const before = await featureDecision(db, key);
      if (before.scope === "all" && !input.enabled) fail("FEATURE_ON_FOR_ALL");
      const tenantIds = input.enabled
        ? [...before.tenantIds, input.tenantId]
        : before.tenantIds.filter((id) => id !== input.tenantId);
      const scope = before.scope === "all" ? "all" : tenantIds.length ? "some" : "off";
      await save(db, key, scope, tenantIds, identity.uid, now);
      return {
        result: { key, tenantId: input.tenantId, enabled: input.enabled, scope },
        audit: { tenantId: input.tenantId, entityType: "feature", entityId: key, before: { enabled: before.tenantIds.includes(input.tenantId) || before.scope === "all" }, after: { enabled: input.enabled } },
      };
    },
  }),

  /** Old, unmanaged flag documents nothing reads. Archived, never deleted. */
  archiveFlag: consoleHandler({
    capability: "features.write",
    input: z.object({ key: z.string().min(1).max(200) }),
    async run({ db, identity, now }, input) {
      if ((CONSOLE_FEATURE_KEYS as string[]).includes(input.key)) fail("FEATURE_IS_LIVE");
      const reference = db.doc(`featureFlags/${input.key}`);
      if (!(await reference.get()).exists) fail("FLAG_NOT_FOUND");
      await reference.set({ archivedAt: now, updatedAt: now, updatedBy: identity.uid }, { merge: true });
      return { result: { key: input.key, archived: true }, audit: { tenantId: null, entityType: "feature", entityId: input.key, after: { archived: true } } };
    },
  }),
};
