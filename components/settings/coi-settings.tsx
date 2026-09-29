"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import { useTenantDocuments, refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

type Dial = "off" | "prepare" | "auto";
type Source = "agent" | "self_serve";

/**
 * Settings → Insurance (H3, docs/coi-automation-plan-2026-09-28.md).
 *
 * Who sends the studio's certificates of insurance, saved once. Every COI used
 * to begin with typing the agent's email into a form; with this, a booked job
 * whose venue needs one gets it asked for, chased and brought back for one
 * approval. Studios who generate certificates in their insurer's portal
 * (Hiscox, NEXT, Thimble…) get a task with the details to paste instead of an
 * email to an agent.
 */
export function CoiSettings() {
  const workspace = useWorkspace();
  const canEdit = ["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""));
  const isOwner = workspace.role === "studio_owner";
  const { records } = useTenantDocuments("coiSettings", {
    enabled: ["studio_owner", "studio_admin", "studio_coordinator"].includes(String(workspace.role ?? "")),
  });
  const stored = (records ?? [])[0] as Record<string, unknown> | undefined;
  const [edits, setEdits] = useState<Record<string, string | boolean | number | null>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const value = <T,>(key: string, fallback: T): T => (key in edits ? (edits[key] as T) : ((stored?.[key] as T) ?? fallback));
  const set = (key: string, next: string | boolean | number | null) => {
    setSaved(false);
    setEdits((current) => ({ ...current, [key]: next }));
  };
  const source = value<Source>("source", "agent");
  const dial = value<Dial>("dial", "prepare");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await sendPlanningCommand("saveCoiSettings", {
        source,
        agentName: value<string | null>("agentName", null) || null,
        agency: value<string | null>("agency", null) || null,
        agentEmail: value<string | null>("agentEmail", null) || null,
        agentPhone: value<string | null>("agentPhone", null) || null,
        ccStudio: value<boolean>("ccStudio", false),
        portalUrl: value<string | null>("portalUrl", null) || null,
        leadDays: Number(value<number>("leadDays", 60)),
        chaseEveryDays: Number(value<number>("chaseEveryDays", 3)),
        maxChases: Number(value<number>("maxChases", 4)),
        agentNotes: value<string | null>("agentNotes", null) || null,
        dial,
      });
      refreshTenantRecords("coiSettings");
      setSaved(true);
      setEdits({});
    } catch (caught: unknown) {
      setError(friendlyError(caught, "These settings could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return <p className="form-notice">Only the studio owner or an admin can change who sends your certificates.</p>;
  }

  return (
    <form
      className="crm-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="crm-form-grid">
        <fieldset className="form-span coi-settings-source">
          <legend>How do you get certificates of insurance?</legend>
          <label className="form-checkbox">
            <input checked={source === "agent"} onChange={() => set("source", "agent")} type="radio" />
            <span>My insurance agent or broker emails them</span>
          </label>
          <label className="form-checkbox">
            <input checked={source === "self_serve"} onChange={() => set("source", "self_serve")} type="radio" />
            <span>I make them myself in my insurer&rsquo;s portal (Hiscox, NEXT, Thimble…)</span>
          </label>
        </fieldset>
        {source === "agent" ? (
          <>
            <label>
              Agent&rsquo;s name
              <input onChange={(event) => set("agentName", event.target.value)} value={value("agentName", "") ?? ""} />
            </label>
            <label>
              Agency
              <input onChange={(event) => set("agency", event.target.value)} value={value("agency", "") ?? ""} />
            </label>
            <label>
              Agent&rsquo;s email
              <input
                onChange={(event) => set("agentEmail", event.target.value)}
                required
                type="email"
                value={value("agentEmail", "") ?? ""}
              />
              <small>Requests go here. Their reply with the PDF comes straight back to the job.</small>
            </label>
            <label>
              Agent&rsquo;s phone
              <input onChange={(event) => set("agentPhone", event.target.value)} type="tel" value={value("agentPhone", "") ?? ""} />
              <small>Shown on Today if they go quiet.</small>
            </label>
            <label className="form-span">
              Standing notes for your agent <span className="coi-optional">optional</span>
              <textarea
                onChange={(event) => set("agentNotes", event.target.value)}
                placeholder="e.g. Policy number HX-12345. Please name the venue as additional insured."
                value={value("agentNotes", "") ?? ""}
              />
            </label>
          </>
        ) : (
          <label className="form-span">
            Your insurer&rsquo;s certificate page
            <input
              onChange={(event) => set("portalUrl", event.target.value)}
              placeholder="https://…"
              type="url"
              value={value("portalUrl", "") ?? ""}
            />
            <small>Today links here with the holder, address and date ready to paste.</small>
          </label>
        )}
        <label>
          Ask this many days before the event
          <input
            max={365}
            min={7}
            onChange={(event) => set("leadDays", Number(event.target.value))}
            type="number"
            value={value<number>("leadDays", 60)}
          />
          <small>Not earlier: a certificate issued a year out can show a policy that renews before the day.</small>
        </label>
        {source === "agent" ? (
          <>
            <label>
              Chase every (days)
              <input
                max={14}
                min={1}
                onChange={(event) => set("chaseEveryDays", Number(event.target.value))}
                type="number"
                value={value<number>("chaseEveryDays", 3)}
              />
              <small>Every day in the final week before it&rsquo;s due.</small>
            </label>
            <label>
              Chase at most
              <input
                max={10}
                min={1}
                onChange={(event) => set("maxChases", Number(event.target.value))}
                type="number"
                value={value<number>("maxChases", 4)}
              />
              <small>Then StudioCue stops and tells you.</small>
            </label>
          </>
        ) : null}
        <fieldset className="form-span coi-settings-source">
          <legend>How far StudioCue goes on its own</legend>
          {(
            [
              ["prepare", "Prepare it — I approve each request before it goes to my agent"],
              ["auto", "Send it — ask my agent as soon as it's time"],
              ["off", "Off — I'll ask for certificates myself"],
            ] as const
          ).map(([key, label]) => (
            <label className="form-checkbox" key={key}>
              <input
                checked={dial === key}
                disabled={!isOwner}
                onChange={() => set("dial", key)}
                type="radio"
              />
              <span>{label}</span>
            </label>
          ))}
          {!isOwner ? <small>Only the studio owner can change this.</small> : null}
        </fieldset>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="form-notice" role="status">
          <CheckCircle2 size={15} /> Saved. Booked jobs whose venue needs a certificate are asked for on schedule.
        </p>
      ) : null}
      <button className="button button-dark" disabled={busy} type="submit">
        {busy ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
        Save insurance settings
      </button>
    </form>
  );
}
