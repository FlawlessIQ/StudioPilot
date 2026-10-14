"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, MoreHorizontal, PencilLine, RotateCcw, X } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { AssigneeSelect, useTaskAssignees } from "@/components/tasks/task-assignee";
import { assigneeFields, assigneeLabel, assigneeValue } from "@/features/tasks/assignee";
import { taskIsSettled } from "@/features/tasks/schema";
import { friendlyError } from "@/lib/ai/friendly-error";
import { daysUntilEvent, formatDueDate } from "@/lib/format/event-date";
import { runWorkflowCommand } from "@/lib/workflows/command-client";

export type TaskRow = {
  id: string;
  status: string;
  title?: string;
  description?: string;
  dueDate?: string | null;
  priority?: string;
  assignedUserId?: string | null;
  assignedRole?: string | null;
};

/** How long "Undo" stays beside a task just marked done. */
const UNDO_WINDOW_MS = 8000;

/**
 * One task as one line: a tick box, the title, and "15 days late · Smith
 * Wedding · For you" under it.
 *
 * Each task used to be a ~250px card — Due, Priority and For on lines of their
 * own, "Mark done", "Edit" and "Cancel" stacked as text, a late date printed
 * like any other (laptop UI audit, 2026-10-14). Priority shows only when it is
 * above normal, and Edit and Cancel live in the row's ··· menu.
 *
 * Marking done offers Undo for a few seconds, and a settled task can be
 * reopened afterwards: `completeTask` had no caller until this row existed,
 * and then tasks only went one way. A settled task keeps its row, because the
 * list is also the record of what was done.
 */
export function TaskListRow({
  task,
  href,
  projectName,
}: {
  task: TaskRow;
  href?: string;
  projectName?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const settled = taskIsSettled(task.status);
  const cancelled = String(task.status) === "cancelled";
  const forLabel = assigneeLabel(assigneeValue(task), useTaskAssignees());
  const forEl = forLabel ? <span className="task-row-assignee">For {forLabel}</span> : null;
  const days = task.dueDate ? daysUntilEvent(task.dueDate) : null;
  const late = !settled && days !== null && days < 0;
  const priority = String(task.priority ?? "normal");

  useEffect(() => {
    if (!justCompleted) return;
    const timer = window.setTimeout(() => setJustCompleted(false), UNDO_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [justCompleted]);

  async function run(type: string, input: Record<string, unknown>, done: string, fallback: string) {
    setBusy(type);
    setNotice(null);
    try {
      await runWorkflowCommand(type, { taskId: task.id, ...input });
      refreshTenantRecords("tasks", "projects");
      setNotice(done);
      return true;
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, fallback));
      return false;
    } finally {
      setBusy(null);
    }
  }

  const title = task.title || "Untitled task";
  return (
    <article className={`task-list-row${settled ? " is-settled" : ""}${late ? " is-late" : ""}`}>
      <button
        aria-label={settled ? (cancelled ? "Canceled" : justCompleted ? "Undo" : "Reopen") : `Mark "${title}" done`}
        aria-pressed={settled}
        className="task-check"
        disabled={busy !== null || cancelled}
        onClick={() =>
          settled
            ? void run("reopenTask", {}, "Reopened.", "That task could not be reopened.").then((ok) => {
                if (ok) setJustCompleted(false);
              })
            : void run("completeTask", {}, "Marked done.", "That task could not be completed.").then((ok) => {
                if (ok) setJustCompleted(true);
              })
        }
        title={settled ? (cancelled ? "Canceled" : "Reopen") : "Mark done"}
        type="button"
      >
        {busy === "completeTask" || busy === "reopenTask" ? (
          <LoaderCircle className="spin" size={14} />
        ) : settled && !cancelled ? (
          <Check size={14} />
        ) : cancelled ? (
          <X size={14} />
        ) : null}
      </button>
      <div className="task-list-main">
        {href ? (
          <Link className="task-list-title" href={href}>
            {title}
          </Link>
        ) : (
          <strong className="task-list-title">{title}</strong>
        )}
        <span className="task-list-meta">
          {settled ? (
            <span>{cancelled ? "Canceled" : "Done"}</span>
          ) : days === null ? (
            <span>No due date</span>
          ) : late ? (
            <span className="task-late">
              {-days === 1 ? "1 day late" : `${-days} days late`}
            </span>
          ) : (
            <span>{days === 0 ? "Due today" : `Due ${formatDueDate(task.dueDate)}`}</span>
          )}
          {projectName ? <span>{projectName}</span> : null}
          {forEl}
        </span>
      </div>
      <span className="task-list-flags">
        {!settled && (priority === "urgent" || priority === "high") ? (
          <StatusBadge tone={priority === "urgent" ? "danger" : "warning"}>
            {priority === "urgent" ? "Urgent" : "High"}
          </StatusBadge>
        ) : null}
        {justCompleted ? (
          <button
            className="button button-quiet task-undo"
            disabled={busy !== null}
            onClick={() =>
              void run("reopenTask", {}, "Reopened.", "That task could not be reopened.").then((ok) => {
                if (ok) setJustCompleted(false);
              })
            }
            type="button"
          >
            <RotateCcw size={14} /> Undo
          </button>
        ) : null}
        {cancelled ? null : (
          <button
            aria-expanded={menuOpen}
            aria-label={`More for "${title}"`}
            className="task-menu-toggle"
            onClick={() => {
              setMenuOpen((open) => !open);
              setConfirmCancel(false);
            }}
            type="button"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </span>
      {menuOpen ? (
        <div className="task-list-menu">
          {settled ? (
            <button
              className="button button-quiet"
              disabled={busy !== null}
              onClick={() =>
                void run("reopenTask", {}, "Reopened.", "That task could not be reopened.").then((ok) => {
                  if (ok) setMenuOpen(false);
                })
              }
              type="button"
            >
              <RotateCcw size={14} /> Reopen
            </button>
          ) : (
            <>
              <button
                className="button button-quiet"
                disabled={busy !== null}
                onClick={() => setEditing((open) => !open)}
                type="button"
              >
                <PencilLine size={14} /> Edit
              </button>
              {confirmCancel ? (
                <>
                  <button
                    className="button button-danger"
                    disabled={busy !== null}
                    onClick={() =>
                      void run("cancelTask", { reason: null }, "Canceled. It stays on the list as a record.", "That task could not be canceled.").then(
                        () => setConfirmCancel(false),
                      )
                    }
                    type="button"
                  >
                    {busy === "cancelTask" ? <LoaderCircle className="spin" size={14} /> : null}{" "}
                    Cancel the task
                  </button>
                  <button className="button button-quiet" onClick={() => setConfirmCancel(false)} type="button">
                    Keep it
                  </button>
                </>
              ) : (
                <button
                  className="button button-quiet"
                  disabled={busy !== null}
                  onClick={() => setConfirmCancel(true)}
                  type="button"
                >
                  <X size={14} /> Cancel
                </button>
              )}
            </>
          )}
        </div>
      ) : null}
      {editing ? (
        <TaskEditForm
          busy={busy === "updateTask"}
          onCancel={() => setEditing(false)}
          onSave={(changes) =>
            void run("updateTask", changes, "Saved.", "That task could not be saved.").then((ok) => {
              if (ok) {
                setEditing(false);
                setMenuOpen(false);
              }
            })
          }
          task={task}
        />
      ) : null}
      {notice ? (
        <p className="form-notice task-list-notice" role="status">
          {notice}
        </p>
      ) : null}
    </article>
  );
}

function TaskEditForm({
  task,
  busy,
  onSave,
  onCancel,
}: {
  task: TaskRow;
  busy: boolean;
  onSave: (changes: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(task.title ?? "");
  const [description, setDescription] = useState(task.description ?? "");
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [priority, setPriority] = useState(task.priority || "normal");
  const [assignee, setAssignee] = useState(assigneeValue(task));
  return (
    <form
      className="task-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim().length < 2) return;
        onSave({
          title: title.trim(),
          description: description.trim(),
          dueDate: /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null,
          priority,
          ...assigneeFields(assignee),
        });
      }}
    >
      <label>
        Task
        <input maxLength={200} minLength={2} onChange={(event) => setTitle(event.target.value)} required value={title} />
      </label>
      <label>
        Due
        <input onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
      </label>
      <AssigneeSelect onChange={setAssignee} value={assignee} />
      <label>
        Priority
        <select onChange={(event) => setPriority(event.target.value)} value={priority}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <label className="task-edit-span">
        Notes
        <textarea maxLength={3000} onChange={(event) => setDescription(event.target.value)} rows={2} value={description} />
      </label>
      <div>
        <button className="button button-dark" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={14} /> : null}{" "}
          Save
        </button>
        <button className="button button-quiet" onClick={onCancel} type="button">
          Close
        </button>
      </div>
    </form>
  );
}
