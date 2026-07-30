"use client";

import { useState, type FormEvent } from "react";
import { Check, Clock3, Plus, ShieldCheck } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPlanningCommand } from "@/lib/planning/command-client";

type RuleRecord = Record<string, unknown> & { id: string };

const number = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

export function TimingRuleEditor() {
  const workspace = useWorkspace();
  const { records, loading } = useTenantDocuments("timingRules");
  const [editing, setEditing] = useState<RuleRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = ["studio_owner", "studio_admin"].includes(
    String(workspace.role),
  );

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await sendPlanningCommand("saveTimingRule", {
        ruleId: editing?.id ?? null,
        name: String(form.get("name")),
        eventTypeId: String(form.get("eventTypeId")),
        anchor: String(form.get("anchor")),
        offsetMinutes: number(form.get("offsetMinutes")),
        durationMinutes: number(form.get("durationMinutes")),
        bufferBeforeMinutes: number(form.get("bufferBeforeMinutes")),
        bufferAfterMinutes: number(form.get("bufferAfterMinutes")),
        active: form.get("active") === "on",
      });
      setNotice(
        "Timing rule saved. Future schedule drafts will cite its approved version.",
      );
      setEditing(null);
      setShowForm(false);
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Timing rule could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel timing-rule-editor">
      <header className="panel-heading">
        <div>
          <p className="eyebrow">Studio-owned knowledge</p>
          <h2>Timing rules</h2>
          <p>
            Define the durations and buffers StudioCue may use. AI suggestions
            never become rules until an owner approves them here.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" />
      </header>
      <div className="timing-rule-list">
        {loading ? <p>Loading timing rules…</p> : null}
        {!loading && !records?.length ? (
          <p className="timing-rule-empty">
            No rules yet. Add your first studio standard, such as family
            portraits or travel buffer.
          </p>
        ) : null}
        {records?.map((rule) => (
          <button
            className={rule.active === true ? "is-active" : ""}
            disabled={!canEdit}
            key={rule.id}
            onClick={() => {
              setEditing(rule);
              setShowForm(true);
            }}
            type="button"
          >
            <Clock3 size={16} />
            <span>
              <strong>{String(rule.name)}</strong>
              <small>
                {String(rule.anchor)} · {number(rule.offsetMinutes)} min offset ·{" "}
                {number(rule.durationMinutes)} min duration
              </small>
            </span>
            <em>
              {rule.active === true ? <Check size={13} /> : null}
              {rule.active === true ? "Approved" : "Draft"} · v
              {number(rule.version)}
            </em>
          </button>
        ))}
      </div>
      {canEdit && !showForm ? (
        <button
          className="button button-light button-sm"
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          type="button"
        >
          <Plus size={15} /> Add timing rule
        </button>
      ) : null}
      {showForm ? (
        <form className="timing-rule-form" onSubmit={(event) => void save(event)}>
          <label>
            Rule name
            <input
              defaultValue={String(editing?.name ?? "")}
              name="name"
              placeholder="Family portraits"
              required
            />
          </label>
          <label>
            Event type
            <select
              defaultValue={String(editing?.eventTypeId ?? "wedding")}
              name="eventTypeId"
            >
              <option value="wedding">Wedding</option>
              <option value="corporate">Corporate</option>
              <option value="sports">Sports</option>
            </select>
          </label>
          <label>
            Anchor
            <input
              defaultValue={String(editing?.anchor ?? "ceremony_start")}
              name="anchor"
              placeholder="ceremony_start"
              required
            />
          </label>
          <label>
            Offset from anchor (minutes)
            <input
              defaultValue={number(editing?.offsetMinutes)}
              max="1440"
              min="-1440"
              name="offsetMinutes"
              type="number"
            />
          </label>
          <label>
            Duration (minutes)
            <input
              defaultValue={number(editing?.durationMinutes) || 30}
              max="1440"
              min="1"
              name="durationMinutes"
              required
              type="number"
            />
          </label>
          <label>
            Buffer before
            <input
              defaultValue={number(editing?.bufferBeforeMinutes)}
              max="600"
              min="0"
              name="bufferBeforeMinutes"
              type="number"
            />
          </label>
          <label>
            Buffer after
            <input
              defaultValue={number(editing?.bufferAfterMinutes)}
              max="600"
              min="0"
              name="bufferAfterMinutes"
              type="number"
            />
          </label>
          <label className="timing-rule-active">
            <input
              defaultChecked={editing ? editing.active === true : true}
              name="active"
              type="checkbox"
            />
            Approved for schedule generation
          </label>
          <footer>
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? "Saving…" : "Save rule"}
            </button>
            <button
              className="button button-light"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setShowForm(false);
              }}
              type="button"
            >
              Cancel
            </button>
          </footer>
        </form>
      ) : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
