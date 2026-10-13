"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle, ListChecks, LoaderCircle, Plus } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  CHECKLIST_STATES,
  PLANNING_CHECKLIST_SOURCE,
  checklistProgress,
  checklistScopeOf,
  isPlanningChecklistTask,
  type ChecklistRow,
} from "@/features/planning/planning-checklist";
import { PLANNING_SCOPE_LABELS } from "@/features/planning/planning-scope";
import { settingsSectionHref } from "@/features/settings/sections";
import { formatDueDate, todayLocalIso } from "@/lib/format/event-date";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runWorkflowCommand } from "@/lib/workflows/command-client";

/** How many open items the panel shows before "Show all". */
const NEXT_UP = 3;

function dueWords(row: ChecklistRow, today: string): string {
  if (row.status === "complete" || row.status === "completed") return "Done";
  if (!row.dueDate) return "No date";
  if (row.dueDate < today) return `Overdue · was due ${formatDueDate(row.dueDate)}`;
  if (row.dueDate === today) return "Due today";
  return `Due ${formatDueDate(row.dueDate)}`;
}

/**
 * A planner's planning checklist on the job (docs/planner-journey-plan.md,
 * N8): "6 of 18 done", the next three due, mark one done, add a one-off.
 *
 * Only on a full or partial planning job (features/planning/planning-checklist.ts);
 * every other job renders nothing. The items are ordinary tasks, so they
 * still reach Today when due and still open in the task list, where they can
 * be edited or removed. Compact rows on every width, never cards.
 */
export function PlanningChecklistPanel({
  project,
  projectId,
  tasks,
}: {
  project: Record<string, unknown>;
  projectId: string;
  tasks: ReadonlyArray<Record<string, unknown>>;
}) {
  const workspace = useWorkspace();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");

  const role = String(workspace.role ?? "");
  const canWork = ["studio_owner", "studio_admin", "studio_coordinator"].includes(role);
  const mayEditList = role === "studio_owner" || role === "studio_admin";
  const scope = checklistScopeOf(project);
  const own = tasks.filter((task) => isPlanningChecklistTask(task));
  const applies = scope !== null && CHECKLIST_STATES.has(String(project.state ?? ""));
  if (!canWork || (!own.length && !applies)) return null;

  const today = todayLocalIso();
  const progress = checklistProgress(
    own.map((task) => (overrides[String(task.id)] ? { ...task, status: overrides[String(task.id)] } : task)),
    today,
  );
  const shown = showAll ? [...progress.open, ...progress.finished] : progress.open.slice(0, NEXT_UP);
  const hidden = progress.total - shown.length;
  const marker = (project.planningChecklist ?? null) as { appliedAt?: unknown } | null;
  const hasDate = typeof project.eventDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(project.eventDate);

  async function toggle(row: ChecklistRow) {
    const done = row.status === "complete" || row.status === "completed";
    setBusy(row.id);
    setNotice(null);
    try {
      const outcome = await runWorkflowCommand(done ? "reopenTask" : "completeTask", { taskId: row.id });
      if (!outcome.persisted) {
        setNotice("Preview mode — nothing was saved.");
        return;
      }
      setOverrides((current) => ({ ...current, [row.id]: done ? "not_started" : "complete" }));
      refreshTenantRecords("tasks", "projects");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, done ? "That item could not be reopened." : "That item could not be marked done."));
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const name = title.trim();
    if (name.length < 2) {
      setNotice("Give the item a name.");
      return;
    }
    setBusy("add");
    setNotice(null);
    try {
      const outcome = await runWorkflowCommand("createTask", {
        projectId,
        workflowRunId: null,
        checkpointId: null,
        title: name,
        description: "",
        assignedUserId: null,
        assignedRole: null,
        dueDate: dueDate || null,
        priority: "normal",
        blocking: false,
        source: PLANNING_CHECKLIST_SOURCE,
      });
      if (!outcome.persisted) {
        setNotice("Preview mode — nothing was saved.");
        return;
      }
      setTitle("");
      setDueDate("");
      setAdding(false);
      setNotice(`Added “${name}”.`);
      refreshTenantRecords("tasks");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That item could not be added."));
    } finally {
      setBusy(null);
    }
  }

  const empty = !progress.total
    ? marker?.appliedAt
      ? "Nothing on it: your studio’s list for this tier is empty. Add what this job needs."
      : hasDate
        ? "Setting up the checklist…"
        : "The checklist is set from the event date. Add the date to the job to get it."
    : null;

  return (
    <section aria-label="Planning checklist" className="panel planning-checklist-panel" id="planning-checklist">
      <header className="planning-checklist-head">
        <span className="planning-checklist-heading">
          <p className="eyebrow">{scope ? PLANNING_SCOPE_LABELS[scope] : "Planning"}</p>
          <h2>Planning checklist</h2>
        </span>
        <button className="button button-sm button-light" onClick={() => setAdding((open) => !open)} type="button">
          <Plus aria-hidden size={14} /> Add an item
        </button>
      </header>
      {progress.total ? (
        <div className="planning-checklist-summary">
          <p>
            <ListChecks aria-hidden size={15} />
            <strong>{progress.summary}</strong>
            {progress.overdue ? <span className="planning-checklist-overdue">{`${progress.overdue} overdue`}</span> : null}
          </p>
          <span aria-hidden className="planning-checklist-bar">
            <span style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </span>
        </div>
      ) : (
        <p className="form-notice planning-checklist-empty">{empty}</p>
      )}
      {adding ? (
        <form
          className="planning-checklist-add"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label>
            Item
            <input
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Book the shuttle buses"
              value={title}
            />
          </label>
          <label>
            Due (optional)
            <input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
          </label>
          <span className="planning-checklist-add-actions">
            <button className="button button-dark" disabled={busy !== null} type="submit">
              {busy === "add" ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
              Add
            </button>
            <button className="button button-light" onClick={() => setAdding(false)} type="button">
              Cancel
            </button>
          </span>
          <small>Just for this job. It keeps the date you give it, even if the date moves.</small>
        </form>
      ) : null}
      {shown.length ? (
        <ul className="planning-checklist-rows">
          {shown.map((row) => {
            const done = row.status === "complete" || row.status === "completed";
            const overdue = !done && row.dueDate !== null && row.dueDate < today;
            return (
              <li className={`planning-checklist-row${done ? " is-done" : ""}${overdue ? " is-overdue" : ""}`} key={row.id}>
                <button
                  aria-label={done ? `Reopen: ${row.title}` : `Mark done: ${row.title}`}
                  aria-pressed={done}
                  className="planning-checklist-check"
                  disabled={busy !== null}
                  onClick={() => void toggle(row)}
                  type="button"
                >
                  {busy === row.id ? (
                    <LoaderCircle aria-hidden className="spin" size={18} />
                  ) : done ? (
                    <CheckCircle2 aria-hidden size={18} />
                  ) : (
                    <Circle aria-hidden size={18} />
                  )}
                </button>
                <span className="planning-checklist-text">
                  <strong>{row.title}</strong>
                  <small>{dueWords(row, today)}</small>
                </span>
              </li>
            );
          })}
        </ul>
      ) : progress.total ? (
        <p className="form-notice planning-checklist-empty">Everything on it is done.</p>
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      <footer className="planning-checklist-foot">
        {hidden > 0 || showAll ? (
          <button className="vendor-team-link" onClick={() => setShowAll((value) => !value)} type="button">
            {showAll ? "Show what’s next" : `Show all ${progress.total}`}
          </button>
        ) : null}
        <Link className="vendor-team-link" href={`/studio/tasks?project=${encodeURIComponent(projectId)}`}>
          Edit or remove items
        </Link>
        {mayEditList ? (
          <Link className="vendor-team-link" href={`${settingsSectionHref("planning")}#planning-checklist-settings`}>
            Your studio’s checklist
          </Link>
        ) : null}
      </footer>
    </section>
  );
}
