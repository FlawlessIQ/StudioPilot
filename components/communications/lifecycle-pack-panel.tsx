"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, ShieldCheck } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  defaultLifecycleMessagingSettings,
  lifecycleMessagingSettingsSchema,
} from "@/features/messaging/schema";
import {
  saveLifecycleSettings,
  type LifecycleSettings,
} from "@/lib/communications/lifecycle-settings-client";

const COPY: Record<
  keyof LifecycleSettings,
  { label: string; detail: string }
> = {
  schedule_confirmation: {
    label: "Schedule confirmation",
    detail: "1 month before · re-confirms every time with the client",
  },
  final_invoice_notice: {
    label: "Final balance summary",
    detail: "1 month before · total − retainer, computed exactly",
  },
  day_before_checklist: {
    label: "Day-before checklist",
    detail: "Dress, shoes, flowers, rings, invitations ready",
  },
};

/**
 * Lifecycle pack + trust dial.
 *
 * Each deterministic lifecycle message can be switched off, and — owner only —
 * graduated from "review each time" to auto-send. AI-personalized drafts are
 * not governed here; they always require review.
 */
export function LifecyclePackPanel() {
  const workspace = useWorkspace();
  const { records: tenants } = useTenantDocuments("tenants");
  const tenant =
    tenants?.find((candidate) => candidate.id === workspace.tenantId) ??
    tenants?.[0];
  const isOwner = workspace.role === "studio_owner";
  const [settings, setSettings] = useState<LifecycleSettings>(
    defaultLifecycleMessagingSettings,
  );
  const [hydrated, setHydrated] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!tenant || hydrated) return;
    const parsed = lifecycleMessagingSettingsSchema.safeParse(
      tenant.lifecycleMessaging,
    );
    const frame = requestAnimationFrame(() => {
      if (parsed.success) setSettings(parsed.data);
      setHydrated(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [tenant, hydrated]);

  function update(
    trigger: keyof LifecycleSettings,
    patch: Partial<LifecycleSettings[keyof LifecycleSettings]>,
  ) {
    setSettings((current) => ({
      ...current,
      [trigger]: { ...current[trigger], ...patch },
    }));
    setDirty(true);
    setNotice(null);
  }

  async function save() {
    if (!workspace.tenantId) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveLifecycleSettings({
        tenantId: workspace.tenantId,
        settings,
      });
      setDirty(false);
      setNotice(
        result.mode === "preview"
          ? "Preview: settings validated without saving."
          : "Lifecycle settings saved.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message.replaceAll("_", " ")
          : "Settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel communications-lifecycle-pack">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Lifecycle pack</p>
          <h2>Automatic drafts</h2>
        </div>
        <ShieldCheck aria-hidden="true" />
      </div>
      <p className="communications-lifecycle-note">
        StudioCue prepares these messages on schedule for every booked project.
        Drafts wait in the AI review queue unless a message is explicitly set
        to send automatically.
      </p>
      <ul className="communications-lifecycle-list">
        {(Object.keys(COPY) as Array<keyof LifecycleSettings>).map(
          (trigger) => (
            <li key={trigger}>
              <span>
                <strong>{COPY[trigger].label}</strong>
                <small>{COPY[trigger].detail}</small>
              </span>
              <span className="communications-lifecycle-controls">
                <label>
                  <input
                    checked={settings[trigger].enabled}
                    disabled={!isOwner}
                    onChange={(event) =>
                      update(trigger, { enabled: event.target.checked })
                    }
                    type="checkbox"
                  />
                  On
                </label>
                <select
                  aria-label={`${COPY[trigger].label} approval mode`}
                  disabled={!isOwner || !settings[trigger].enabled}
                  onChange={(event) =>
                    update(trigger, {
                      autoSend: event.target.value === "auto",
                    })
                  }
                  value={settings[trigger].autoSend ? "auto" : "review"}
                >
                  <option value="review">Review each time</option>
                  <option value="auto">Send automatically</option>
                </select>
              </span>
            </li>
          ),
        )}
      </ul>
      {isOwner && dirty ? (
        <button
          className="button button-dark button-sm"
          disabled={busy}
          onClick={() => void save()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
          Save lifecycle settings
        </button>
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
