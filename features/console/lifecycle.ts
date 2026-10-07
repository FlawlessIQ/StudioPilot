import type { ConsoleStudio, HealthWeightKey, LifecycleStage } from "./model";

/**
 * Console → Lifecycle (docs/console.md, "Lifecycle"): which studios are
 * slipping, and the one thing to do about each.
 *
 * Every studio's health score already lists what cost it points
 * (functions/src/console/model.ts). A play turns the biggest of those into an
 * action a person can take today, with the record tab to take it on and the
 * task to write if it can't be done now. Pure.
 */

export type Play = { key: HealthWeightKey; action: string; task: string; tab: string | null };

const PLAYS: Record<HealthWeightKey, Omit<Play, "key">> = {
  paymentFailed: { action: "Their card failed. Email them to update it.", task: "Help them update their card", tab: "billing" },
  trialEndingUnready: { action: "Trial ends soon with setup unfinished. Offer a setup call.", task: "Offer a setup call before the trial ends", tab: null },
  setupStalled: { action: "Setup has stalled. Offer to finish it with them.", task: "Offer to finish setup together", tab: null },
  noActivity: { action: "Nobody has signed in for two weeks. Check in.", task: "Check in: no activity in two weeks", tab: "usage" },
  activityDrop: { action: "Activity is down sharply. Ask how it's going.", task: "Ask how it's going: activity is down", tab: "usage" },
  integrationDegraded: { action: "An integration is in error. Help them reconnect it.", task: "Help reconnect their integration", tab: "integrations" },
  deadLetters: { action: "Background jobs are failing for them. Look at the cause.", task: "Look into their failed jobs", tab: "jobs" },
  openFeedback: { action: "Their feedback is unanswered. Reply to it.", task: "Answer their feedback", tab: "feedback" },
};

/** The play for a studio's biggest problem, or null when nothing costs it points. */
export function playFor(studio: Pick<ConsoleStudio, "health">): Play | null {
  const top = [...(studio.health?.reasons ?? [])].sort((a, b) => b.points - a.points)[0];
  return top ? { key: top.key, ...PLAYS[top.key] } : null;
}

const RISKY: ReadonlySet<LifecycleStage> = new Set(["at_risk", "stalled"]);

/** At risk, stalled, or a poor score; comped and suspended studios are left to their own pages. */
export function isAtRisk(studio: Pick<ConsoleStudio, "lifecycle" | "health" | "comped" | "suspended" | "removed">): boolean {
  if (studio.removed || studio.suspended || studio.comped) return false;
  if (studio.lifecycle === "churned") return false;
  return RISKY.has(studio.lifecycle) || studio.health?.band === "poor";
}

/** Most urgent first: payment trouble, then trials about to end, then the lowest score. */
type Rankable = Pick<ConsoleStudio, "health" | "trialEndsAt" | "lastPaymentFailedAt">;

export function riskOrder(now: number): (a: Rankable, b: Rankable) => number {
  const rank = (studio: Rankable) => (studio.lastPaymentFailedAt ? 0 : studio.trialEndsAt && Date.parse(studio.trialEndsAt) - now < 3 * 86_400_000 ? 1 : 2);
  return (a, b) => rank(a) - rank(b) || (a.health?.score ?? 100) - (b.health?.score ?? 100);
}

/** `consoleLifecycleEvents`, written by the rollup when a studio's stage changes. */
export type LifecycleEvent = { id: string; tenantId: string; name?: string; from: LifecycleStage; to: LifecycleStage; at: string; healthScore?: number };

const ORDER: LifecycleStage[] = ["signed_up", "setting_up", "stalled", "activated", "paying", "at_risk", "churned", "suspended"];

/** Better, worse, or sideways, for the arrow next to a move. */
export function moveDirection(event: Pick<LifecycleEvent, "from" | "to">): "up" | "down" | "flat" {
  const bad = new Set<LifecycleStage>(["stalled", "at_risk", "churned", "suspended"]);
  if (bad.has(event.to) && !bad.has(event.from)) return "down";
  if (!bad.has(event.to) && bad.has(event.from)) return "up";
  const delta = ORDER.indexOf(event.to) - ORDER.indexOf(event.from);
  return bad.has(event.to) ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}
