"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runWorkflowCommand } from "@/lib/workflows/command-client";

/**
 * Marking a task done.
 *
 * `completeTask` has existed as a command with **no caller anywhere in the
 * product**: a task could be created at /studio/tasks/new and then never
 * finished from any screen. The list showed it, the job page counted it against
 * the studio, and nothing could close it.
 *
 * A settled task keeps its row and loses the button, because the list is also
 * the record of what was done.
 */
export function TaskRecordActions({
  task,
}: {
  task: { id: string; status: string };
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const settled = ["complete", "cancelled"].includes(task.status);

  async function complete() {
    setBusy(true);
    setNotice(null);
    try {
      await runWorkflowCommand("completeTask", { taskId: task.id });
      refreshTenantRecords("tasks", "projects");
      setNotice("Marked done.");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That task could not be completed."));
    } finally {
      setBusy(false);
    }
  }

  if (settled) return null;

  return (
    <span className="task-row-actions">
      <button
        className="button button-quiet"
        disabled={busy}
        onClick={() => void complete()}
        type="button"
      >
        {busy ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <CheckCircle2 size={14} />
        )}{" "}
        Mark done
      </button>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </span>
  );
}
