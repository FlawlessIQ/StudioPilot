"use client";

import { useState } from "react";
import { CheckCircle2, ListChecks, LoaderCircle, Plus, RotateCcw, X } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { PlanningTimelineSettings } from "@/components/planning/planning-timeline-settings";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  CHECKLIST_LIMITS,
  CHECKLIST_SCOPES,
  checklistFor,
  checklistIsCustom,
  checklistProblem,
  type ChecklistItem,
  type ChecklistScope,
  type ChecklistUnit,
} from "@/features/planning/planning-checklist";
import { PLANNING_SCOPE_LABELS } from "@/features/planning/planning-scope";
import { tradeProfile } from "@/features/trades/trades";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * Settings → Planning: the planning timeline, and for a trade that sells
 * planning tiers, the studio's own planning checklist below it.
 */
export function PlanningSettingsSection() {
  const workspace = useWorkspace();
  return (
    <>
      <PlanningTimelineSettings />
      {tradeProfile(workspace.tenantTrade).planningScope ? <PlanningChecklistSettings /> : null}
    </>
  );
}

const newKey = () => `own_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * The studio's planning checklist, per tier (docs/planner-journey-plan.md,
 * N8): rename, remove and add items, and say how long before the day each
 * falls due. The starter list is the default until it is saved. A job takes
 * the list as it is when it books, so a change reaches jobs booked afterwards
 * only. Owner or admin (planningCommand setPlanningChecklist).
 */
export function PlanningChecklistSettings() {
  const workspace = useWorkspace();
  const mayEdit = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records: tenants } = useTenantDocuments("tenants");
  const stored = tenants?.find((entry) => entry.id === workspace.tenantId)?.planningChecklists;
  const [scope, setScope] = useState<ChecklistScope>("full");
  const [drafts, setDrafts] = useState<Partial<Record<ChecklistScope, ChecklistItem[]>>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = drafts[scope] ?? checklistFor(stored, scope);
  const custom = checklistIsCustom(stored, scope);
  const changed = drafts[scope] !== undefined;

  const edit = (next: ChecklistItem[]) => {
    setDrafts((current) => ({ ...current, [scope]: next }));
    setSaved(null);
    setError(null);
  };
  const change = (index: number, patch: Partial<ChecklistItem>) =>
    edit(items.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));

  async function save(next: ChecklistItem[] | null) {
    const tidy = next?.map((entry) => ({ ...entry, title: entry.title.trim() })) ?? null;
    const problem = tidy ? checklistProblem(tidy) : null;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await sendPlanningCommand("setPlanningChecklist", { scope, items: tidy });
      if (!outcome.persisted) {
        setSaved("Preview mode — nothing was saved.");
        return;
      }
      setDrafts((current) => ({ ...current, [scope]: undefined }));
      refreshTenantRecords("tenants");
      setSaved(next ? "Saved. Jobs booked from now on get this list." : "StudioCue’s list is back. Jobs booked from now on get it.");
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The checklist couldn’t be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="planning-checklist-settings-title" className="panel planning-checklist-settings" id="planning-checklist-settings">
      <div className="email-branding-heading">
        <span className="data-control-icon">
          <ListChecks aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Planning</p>
          <h2 id="planning-checklist-settings-title">Planning checklist</h2>
          <p>
            Full and partial planning jobs get these as dated tasks when they book, due the time you set before the
            day. They show on Today when they’re due. Month-of coordination gets none.
          </p>
        </div>
      </div>
      <div aria-label="Which tier" className="planning-checklist-tiers" role="tablist">
        {CHECKLIST_SCOPES.map((tier) => (
          <button
            aria-selected={tier === scope}
            className={`planning-checklist-tier${tier === scope ? " is-active" : ""}`}
            key={tier}
            onClick={() => {
              setScope(tier);
              setSaved(null);
              setError(null);
            }}
            role="tab"
            type="button"
          >
            {PLANNING_SCOPE_LABELS[tier]}
          </button>
        ))}
      </div>
      <p className="form-notice">
        {`${custom ? "Your own list." : "StudioCue’s list, until you change it."} Changes apply to jobs booked from now on; jobs already booked keep the checklist they have.`}
      </p>
      {items.length ? (
        <ol className="planning-checklist-editor">
          {items.map((entry, index) => (
            <li className="planning-checklist-editor-row" key={entry.key}>
              <label className="planning-checklist-editor-title">
                <span className="sr-only">{`Item ${index + 1}`}</span>
                <input
                  disabled={!mayEdit}
                  maxLength={CHECKLIST_LIMITS.titleMax}
                  onChange={(event) => change(index, { title: event.target.value })}
                  value={entry.title}
                />
              </label>
              <span className="planning-checklist-editor-when">
                <label>
                  <span className="sr-only">How many</span>
                  <input
                    disabled={!mayEdit}
                    inputMode="numeric"
                    max={entry.unit === "months" ? CHECKLIST_LIMITS.months : CHECKLIST_LIMITS.weeks}
                    min={1}
                    onChange={(event) => change(index, { amount: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
                    type="number"
                    value={entry.amount}
                  />
                </label>
                <label>
                  <span className="sr-only">Months or weeks</span>
                  <select
                    disabled={!mayEdit}
                    onChange={(event) => change(index, { unit: event.target.value as ChecklistUnit })}
                    value={entry.unit}
                  >
                    <option value="months">{entry.amount === 1 ? "month" : "months"} before</option>
                    <option value="weeks">{entry.amount === 1 ? "week" : "weeks"} before</option>
                  </select>
                </label>
                {mayEdit ? (
                  <button
                    aria-label={`Remove ${entry.title || `item ${index + 1}`}`}
                    className="button button-quiet planning-checklist-editor-remove"
                    onClick={() => edit(items.filter((_, at) => at !== index))}
                    type="button"
                  >
                    <X aria-hidden size={15} />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="form-notice">No items: full and partial jobs booked from now on get no checklist.</p>
      )}
      {mayEdit ? (
        <div className="final-balance-buttons planning-checklist-editor-actions">
          <button
            className="button button-light"
            disabled={busy || items.length >= CHECKLIST_LIMITS.items}
            onClick={() => edit([...items, { key: newKey(), title: "", amount: 3, unit: "months" }])}
            type="button"
          >
            <Plus aria-hidden size={15} /> Add an item
          </button>
          <button className="button button-dark" disabled={busy || !changed} onClick={() => void save(items)} type="button">
            {busy ? <LoaderCircle aria-hidden className="spin" size={15} /> : null}
            Save
          </button>
          {custom || changed ? (
            <button className="button button-quiet" disabled={busy} onClick={() => void save(null)} type="button">
              <RotateCcw aria-hidden size={14} /> Use StudioCue’s list
            </button>
          ) : null}
          {saved ? (
            <span className="form-notice" role="status">
              <CheckCircle2 aria-hidden size={14} /> {saved}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="form-notice">An owner or admin changes the planning checklist.</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
