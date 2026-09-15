"use client";

import { useMemo, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  defaultLifecycleMessagingSettings,
  lifecycleMessagingSettingsSchema,
} from "@/features/messaging/schema";
import {
  lifecycleTriggerOf,
  trustDialOffers,
  TRUST_DIAL_THRESHOLD,
  type LifecycleDecision,
  type LifecycleTrigger,
} from "@/features/messaging/trust-dial";
import { saveLifecycleSettings } from "@/lib/communications/lifecycle-settings-client";
import { friendlyError } from "@/lib/ai/friendly-error";

const LABELS: Record<LifecycleTrigger, string> = {
  schedule_confirmation: "schedule confirmations",
  final_invoice_notice: "final balance summaries",
  day_before_checklist: "day-before checklists",
};

const DISMISSED_KEY = "studiocue:trust-dial-dismissed";

function readDismissed(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * "You've approved the last three without changes — send these automatically?"
 *
 * Shown where approvals happen (Today, AI review), to the owner only, once per
 * message type until they answer. "Keep asking" is remembered against the
 * newest approval, so the offer returns only after three more unedited ones.
 */
export function TrustDialOffers() {
  const workspace = useWorkspace();
  const isOwner = workspace.role === "studio_owner";
  const { records: actions } = useTenantDocuments("aiActions", { enabled: isOwner });
  const { records: tenants } = useTenantDocuments("tenants", { enabled: isOwner });
  const [busy, setBusy] = useState<LifecycleTrigger | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Record<string, string>>(() =>
    typeof window === "undefined" ? {} : readDismissed(),
  );
  const [accepted, setAccepted] = useState<Set<LifecycleTrigger>>(new Set());

  const tenant = tenants?.find((entry) => entry.id === workspace.tenantId);
  const settings = useMemo(() => {
    const parsed = lifecycleMessagingSettingsSchema.safeParse(tenant?.lifecycleMessaging);
    return parsed.success ? parsed.data : defaultLifecycleMessagingSettings;
  }, [tenant?.lifecycleMessaging]);

  const decisions = useMemo<LifecycleDecision[]>(() => {
    const out: LifecycleDecision[] = [];
    for (const action of actions ?? []) {
      const trigger = lifecycleTriggerOf(action as Record<string, unknown>);
      const decision = action.decision as
        | { actorId?: string; action?: string; decidedAt?: string; editDelta?: unknown }
        | null
        | undefined;
      // Human decisions only: an auto-sent message is not evidence of trust.
      if (!trigger || !decision?.decidedAt || decision.actorId === "lifecycle-message-scheduler") continue;
      out.push({
        trigger,
        decidedAt: decision.decidedAt,
        approved: decision.action === "approved",
        edited: Boolean(decision.editDelta),
      });
    }
    return out;
  }, [actions]);

  const latestByTrigger = (trigger: LifecycleTrigger) =>
    decisions
      .filter((decision) => decision.trigger === trigger)
      .map((decision) => decision.decidedAt)
      .sort()
      .at(-1) ?? "";

  const offers = isOwner
    ? trustDialOffers(decisions, settings).filter(
        (trigger) =>
          !accepted.has(trigger) &&
          (dismissed[trigger] ?? "") < latestByTrigger(trigger),
      )
    : [];

  async function turnOn(trigger: LifecycleTrigger) {
    if (!workspace.tenantId) return;
    setBusy(trigger);
    setNotice(null);
    try {
      const result = await saveLifecycleSettings({
        tenantId: workspace.tenantId,
        settings: { ...settings, [trigger]: { ...settings[trigger], autoSend: true } },
      });
      setAccepted((current) => new Set(current).add(trigger));
      setNotice(
        result.mode === "preview"
          ? "Development preview: the setting was not saved."
          : `Done — ${LABELS[trigger]} now send automatically. Change it any time in Settings.`,
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That setting could not be saved."));
    } finally {
      setBusy(null);
    }
  }

  function keepAsking(trigger: LifecycleTrigger) {
    const next = { ...dismissed, [trigger]: latestByTrigger(trigger) };
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: the offer simply returns next visit.
    }
  }

  if (!offers.length && !notice) return null;
  return (
    <section className="trust-dial-offers" aria-label="Send automatically">
      {offers.map((trigger) => (
        <article className="trust-dial-offer" key={trigger}>
          <span className="trust-dial-icon" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <div>
            <strong>Send {LABELS[trigger]} automatically?</strong>
            <small>
              You approved the last {TRUST_DIAL_THRESHOLD} without changing a
              word. StudioCue can send them on schedule; anything with missing
              details still waits for you.
            </small>
          </div>
          <div className="trust-dial-actions">
            <button
              className="button button-dark button-sm"
              disabled={busy !== null}
              onClick={() => void turnOn(trigger)}
              type="button"
            >
              {busy === trigger ? <LoaderCircle className="spin" size={14} /> : null}
              Send automatically
            </button>
            <button
              className="button button-light button-sm"
              disabled={busy !== null}
              onClick={() => keepAsking(trigger)}
              type="button"
            >
              Keep asking
            </button>
          </div>
        </article>
      ))}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
