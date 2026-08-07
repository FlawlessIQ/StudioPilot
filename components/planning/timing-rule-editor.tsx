"use client";

import { useState, type FormEvent } from "react";
import { Check, Clock3, LoaderCircle, Plus, ShieldCheck, Sparkles } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  proposeTimingRules,
  type ProposedTimingRule,
} from "@/lib/ai/timing-rules-client";
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
  const [showLearn, setShowLearn] = useState(false);
  const [learnText, setLearnText] = useState("");
  const [learnBusy, setLearnBusy] = useState(false);
  const [proposals, setProposals] = useState<ProposedTimingRule[]>([]);
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [savingProposal, setSavingProposal] = useState<string | null>(null);
  const canEdit = ["studio_owner", "studio_admin"].includes(
    String(workspace.role),
  );

  async function learn() {
    if (!workspace.tenantId || learnText.trim().length < 40) {
      setNotice("Paste a full past schedule first — at least a few lines.");
      return;
    }
    setLearnBusy(true);
    setNotice(null);
    try {
      const result = await proposeTimingRules({
        tenantId: workspace.tenantId,
        eventTypeId: "wedding",
        scheduleText: learnText,
      });
      setProposals(result.rules);
      setAssumptions(result.assumptions);
      if (result.mode === "preview")
        setNotice("Preview mode: example proposal shown without analysis.");
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "We couldn't read timing rules from that schedule. Try again.",
      );
    } finally {
      setLearnBusy(false);
    }
  }

  async function saveProposal(rule: ProposedTimingRule, active: boolean) {
    setSavingProposal(rule.name);
    setNotice(null);
    try {
      await sendPlanningCommand("saveTimingRule", {
        ruleId: null,
        name: rule.name,
        eventTypeId: "wedding",
        anchor: rule.anchor,
        offsetMinutes: rule.offsetMinutes,
        durationMinutes: rule.durationMinutes,
        bufferBeforeMinutes: rule.bufferBeforeMinutes,
        bufferAfterMinutes: rule.bufferAfterMinutes,
        active,
      });
      setProposals((current) =>
        current.filter((candidate) => candidate.name !== rule.name),
      );
      setNotice(
        active
          ? `"${rule.name}" approved. Future schedule drafts will use it.`
          : `"${rule.name}" saved as a draft rule.`,
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "The rule could not be saved.",
      );
    } finally {
      setSavingProposal(null);
    }
  }

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
        <div className="timing-rule-actions">
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
          <button
            className="button button-light button-sm"
            onClick={() => setShowLearn((current) => !current)}
            type="button"
          >
            <Sparkles size={15} /> Learn from a past schedule
          </button>
        </div>
      ) : null}
      {canEdit && showLearn ? (
        <div className="timing-rule-learn">
          <p>
            Paste one of your past run-of-show documents. StudioCue proposes
            reusable timing rules — nothing becomes a rule until you approve
            it here.
          </p>
          <textarea
            aria-label="Past schedule text"
            onChange={(event) => setLearnText(event.target.value)}
            placeholder={"1:00–1:15 Details with bride\n1:30 Robe/PJ shot\n3:00–4:15 Ceremony…"}
            value={learnText}
          />
          <button
            className="button button-dark button-sm"
            disabled={learnBusy}
            onClick={() => void learn()}
            type="button"
          >
            {learnBusy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
            {learnBusy ? "Reading schedule…" : "Propose rules"}
          </button>
          {proposals.map((rule) => (
            <article className="timing-rule-proposal" key={rule.name}>
              <span>
                <strong>{rule.name}</strong>
                <small>
                  {rule.anchor} · {rule.offsetMinutes} min offset ·{" "}
                  {rule.durationMinutes} min · buffers {rule.bufferBeforeMinutes}
                  /{rule.bufferAfterMinutes}
                </small>
                <em>{rule.rationale}</em>
              </span>
              <span className="timing-rule-proposal-actions">
                <button
                  className="button button-dark button-sm"
                  disabled={savingProposal !== null}
                  onClick={() => void saveProposal(rule, true)}
                  type="button"
                >
                  {savingProposal === rule.name ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : (
                    <Check size={14} />
                  )}
                  Approve
                </button>
                <button
                  className="button button-light button-sm"
                  disabled={savingProposal !== null}
                  onClick={() => void saveProposal(rule, false)}
                  type="button"
                >
                  Save draft
                </button>
              </span>
            </article>
          ))}
          {assumptions.length ? (
            <ul className="timing-rule-assumptions">
              {assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          ) : null}
        </div>
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
