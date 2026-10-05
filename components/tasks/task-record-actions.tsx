"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, LoaderCircle, PencilLine, RotateCcw, X } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { AssigneeSelect, useTaskAssignees } from "@/components/tasks/task-assignee";
import { assigneeFields, assigneeLabel, assigneeValue } from "@/features/tasks/assignee";
import { taskIsSettled } from "@/features/tasks/schema";
import { friendlyError } from "@/lib/ai/friendly-error";
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
 * Marking a task done, and every way back from it.
 *
 * `completeTask` had no caller until this row existed, and then tasks only
 * went one way: a mis-click on "Mark done" was permanent, a task could not be
 * edited, reassigned or called off, and a cancelled one could still be marked
 * done. Now an open task can be edited or cancelled, "Mark done" offers Undo
 * for a few seconds, and a settled task can be reopened afterwards.
 *
 * A settled task keeps its row, because the list is also the record of what
 * was done.
 */
export function TaskRecordActions({ task }: { task: TaskRow }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const settled = taskIsSettled(task.status);
  // Who it's for, on the row itself: the picker set it, but nothing showed it
  // (prod walk, 2026-09-30).
  const forLabel = assigneeLabel(assigneeValue(task), useTaskAssignees());
  const forEl = forLabel ? <small className="task-row-assignee">For {forLabel}</small> : null;

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

  const spinner = (type: string) =>
    busy === type ? <LoaderCircle className="spin" size={14} /> : null;

  if (settled) {
    return (
      <span className="task-row-actions">
        {forEl}
        <button
          className="button button-quiet"
          disabled={busy !== null}
          onClick={() =>
            void run("reopenTask", {}, "Reopened.", "That task could not be reopened.").then((ok) => {
              if (ok) setJustCompleted(false);
            })
          }
          type="button"
        >
          {spinner("reopenTask") ?? <RotateCcw size={14} />} {justCompleted ? "Undo" : "Reopen"}
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </span>
    );
  }

  return (
    <span className="task-row-actions">
      {forEl}
      <button
        className="button button-quiet"
        disabled={busy !== null}
        onClick={() =>
          void run("completeTask", {}, "Marked done.", "That task could not be completed.").then((ok) => {
            if (ok) setJustCompleted(true);
          })
        }
        type="button"
      >
        {spinner("completeTask") ?? <CheckCircle2 size={14} />}{" "}
        Mark done
      </button>
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
            {spinner("cancelTask")}{" "}
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
      {editing ? (
        <TaskEditForm
          busy={busy === "updateTask"}
          onCancel={() => setEditing(false)}
          onSave={(changes) =>
            void run("updateTask", changes, "Saved.", "That task could not be saved.").then((ok) => {
              if (ok) setEditing(false);
            })
          }
          task={task}
        />
      ) : null}
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </span>
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
