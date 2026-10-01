"use client";

import Link from "next/link";
import { relative, shortDate } from "@/lib/console/format";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "./console-context";
import { Empty } from "./ui";
import { useCommand } from "./use-command";

/** A follow-up the team set itself (consoleTasks). */
export type ConsoleTask = {
  id: string;
  title?: string;
  subjectKey?: string | null;
  tenantId?: string | null;
  dueAt?: string | null;
  assigneeUid?: string;
  assigneeEmail?: string | null;
  status?: "open" | "done";
  createdAt?: string;
  completedAt?: string | null;
};

export function dueState(task: ConsoleTask, now = Date.now()): "overdue" | "today" | "later" | "none" {
  if (!task.dueAt || task.status === "done") return "none";
  const due = Date.parse(task.dueAt);
  if (due < now) return "overdue";
  return new Date(due).toDateString() === new Date(now).toDateString() ? "today" : "later";
}

const dueClass: Record<ReturnType<typeof dueState>, string> = { overdue: "cx-error", today: "cx-strong", later: "cx-hint", none: "cx-hint" };

/** A short checklist of tasks with one-click completion. */
export function TasksList({ tasks, empty, showStudio = false }: { tasks: ConsoleTask[]; empty: string; showStudio?: boolean }) {
  const { can, studioById } = useConsole();
  const { run } = useCommand();
  if (!tasks.length) return <Empty title={empty} />;
  return (
    <ul className="cx-checklist" style={{ padding: "8px 12px" }}>
      {tasks.map((task) => {
        const state = dueState(task);
        const studio = showStudio ? studioById(task.tenantId) : undefined;
        return (
          <li data-done={task.status === "done" ? "false" : "true"} key={task.id}>
            <input
              aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}
              checked={task.status === "done"}
              className="cx-checkbox"
              disabled={!can("crm.write")}
              onChange={() =>
                void run(
                  "updateTask",
                  { taskId: task.id, status: task.status === "done" ? "open" : "done" },
                  { done: task.status === "done" ? "Task reopened." : "Task done." },
                )
              }
              type="checkbox"
            />
            <span style={{ flex: 1, minWidth: 0, textDecoration: task.status === "done" ? "line-through" : undefined }}>
              {task.title}
              {studio ? (
                <>
                  {" · "}
                  <Link className="cx-link" href={studioHref(studio.tenantId)}>
                    {studio.name}
                  </Link>
                </>
              ) : null}
            </span>
            {task.status === "done" ? (
              <span className="cx-hint">{relative(task.completedAt)}</span>
            ) : task.dueAt ? (
              <span className={dueClass[state]}>
                {state === "overdue" ? `Overdue · ${shortDate(task.dueAt)}` : state === "today" ? "Today" : shortDate(task.dueAt)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
