/**
 * The trust dial: when to offer to stop asking.
 *
 * Every scheduled client message waits for the studio's tap, and the
 * auto-send setting that ends that sat on a settings page nobody opens. So the
 * tap count per wedding never fell. The evidence that a message type can go
 * out on its own is already in the approval record: the studio approved it,
 * several times, without changing a word. That is when to ask — once, in the
 * place the approvals happen.
 *
 * Only for deterministic lifecycle messages (templates rendered from the
 * job's own facts). Money, signatures and model-written drafts stay on
 * approval; nothing here can reach them.
 */

import type { LifecycleMessagingSettings } from "@/features/messaging/schema";

export type LifecycleTrigger = keyof LifecycleMessagingSettings;

/** Consecutive unedited approvals before the offer appears. */
export const TRUST_DIAL_THRESHOLD = 3;

export type LifecycleDecision = {
  trigger: LifecycleTrigger;
  /** When a person decided; newest decisions matter. */
  decidedAt: string;
  approved: boolean;
  edited: boolean;
};

const TITLE_TRIGGERS: Record<string, LifecycleTrigger> = {
  "review schedule confirmation": "schedule_confirmation",
  "review final invoice notice": "final_invoice_notice",
  "review day before checklist": "day_before_checklist",
};

/**
 * Which lifecycle message an AI action is, or null.
 *
 * New actions carry `lifecycleTrigger`; older ones only a title the scheduler
 * built from the trigger ("Review schedule confirmation").
 */
export function lifecycleTriggerOf(action: {
  lifecycleTrigger?: unknown;
  instructionVersion?: unknown;
  title?: unknown;
}): LifecycleTrigger | null {
  if (typeof action.lifecycleTrigger === "string" && action.lifecycleTrigger in TITLE_TRIGGERS_BY_KEY) {
    return action.lifecycleTrigger as LifecycleTrigger;
  }
  if (action.instructionVersion !== "lifecycle_v1") return null;
  const title = typeof action.title === "string" ? action.title.trim().toLowerCase() : "";
  return TITLE_TRIGGERS[title] ?? null;
}

const TITLE_TRIGGERS_BY_KEY: Record<LifecycleTrigger, true> = {
  schedule_confirmation: true,
  final_invoice_notice: true,
  day_before_checklist: true,
};

/**
 * The triggers worth offering to send automatically.
 *
 * A trigger qualifies when its most recent `TRUST_DIAL_THRESHOLD` human
 * decisions were all approvals with no edits, and auto-send is still off. One
 * edit or rejection in that window resets it — the studio is still shaping
 * the message.
 */
export function trustDialOffers(
  decisions: readonly LifecycleDecision[],
  settings: LifecycleMessagingSettings,
): LifecycleTrigger[] {
  const offers: LifecycleTrigger[] = [];
  for (const trigger of Object.keys(TITLE_TRIGGERS_BY_KEY) as LifecycleTrigger[]) {
    const setting = settings[trigger];
    if (!setting.enabled || setting.autoSend) continue;
    const recent = decisions
      .filter((decision) => decision.trigger === trigger)
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))
      .slice(0, TRUST_DIAL_THRESHOLD);
    if (
      recent.length === TRUST_DIAL_THRESHOLD &&
      recent.every((decision) => decision.approved && !decision.edited)
    ) {
      offers.push(trigger);
    }
  }
  return offers;
}
