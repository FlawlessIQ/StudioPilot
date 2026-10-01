import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { applyManagedFeatures } from "./features.js";
import { expireLocalComps } from "./handlers/billing.js";
import { syncCodesFromStripe } from "./handlers/codes.js";
import { refreshAllSummaries } from "./rollup.js";

/**
 * The Console's housekeeping, every 15 minutes (docs/console.md):
 *
 * - ends comps whose end date has passed, before the rows are built, so a
 *   studio's row never says "comped" after its comp ended;
 * - rebuilds every studio and people row, and today's metrics;
 * - re-applies feature rollouts, so a studio created since the last run picks
 *   up anything that is on for every studio;
 * - refreshes discount-code redemption counts from Stripe.
 *
 * Listed in scripts/configure-production-function-invokers.sh: this org resets
 * invoker IAM on every revision, and an unlisted scheduler 403s silently.
 */
export const consoleRollupScheduler = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "UTC",
    retryCount: 1,
    timeoutSeconds: 540,
    memory: "512MiB",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async () => {
    const db = getFirestore();
    const now = new Date().toISOString();
    const compsExpired = await expireLocalComps(db, now);
    const outcome = await refreshAllSummaries(db, getAuth());
    const featuresChanged = await applyManagedFeatures(db, now);
    let codesSynced = 0;
    try {
      codesSynced = await syncCodesFromStripe(db);
    } catch (caught) {
      console.error(JSON.stringify({ severity: "ERROR", event: "console.codes_sync_failed", detail: caught instanceof Error ? caught.message.slice(0, 300) : "unknown" }));
    }
    console.log(JSON.stringify({ severity: "INFO", event: "console.rollup", ...outcome, featuresChanged, compsExpired, codesSynced }));
  },
);
