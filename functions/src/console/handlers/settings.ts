import { z } from "zod";
import { REASON_MIN, consoleHandler } from "../command-kit.js";
import { DEFAULT_HEALTH_WEIGHTS, type HealthWeightKey } from "../model.js";

const weight = z.number().int().min(0).max(100);
const weightKeys = Object.keys(DEFAULT_HEALTH_WEIGHTS) as HealthWeightKey[];

/** Console settings (docs/console.md, "Settings"). */
export const settingsHandlers = {
  /** How many points each signal costs a studio's health score. Applied from the next rollup. */
  setHealthWeights: consoleHandler({
    capability: "settings.write",
    input: z.object({
      weights: z.object(Object.fromEntries(weightKeys.map((key) => [key, weight])) as Record<HealthWeightKey, typeof weight>),
      reason: z.string().trim().min(REASON_MIN).max(1000),
    }),
    async run({ db, identity, now }, input) {
      const reference = db.doc("consoleSettings/health");
      const before = (await reference.get()).get("weights") ?? DEFAULT_HEALTH_WEIGHTS;
      await reference.set({ weights: input.weights, updatedAt: now, updatedBy: identity.uid }, { merge: true });
      return {
        result: { weights: input.weights },
        audit: { tenantId: null, entityType: "console_settings", entityId: "health", before, after: input.weights, reason: input.reason },
      };
    },
  }),
};
