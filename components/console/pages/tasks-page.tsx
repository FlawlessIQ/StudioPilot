"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, orderBy, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { relative, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { personHref, studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { TaskDialog } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { Button, Empty, PageHead, Pill, Tabs } from "../ui";
import { useCommand } from "../use-command";
import { type ConsoleTask, dueState } from "../tasks";

/** The team's follow-ups (docs/console.md, "Tasks"). */

type View = "mine" | "overdue" | "week" | "open" | "done";

export function TasksPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { user, studioById, can } = useConsole();
  const { run } = useCommand();
  const view = (["mine", "overdue", "week", "open", "done"].includes(params.get("view") ?? "") ? params.get("view") : "mine") as View;
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const tasks = useLiveQuery<ConsoleTask>("console:tasks", (firestore) => query(collection(firestore, "consoleTasks"), orderBy("createdAt", "desc"), limit(1000)));
  const now = useNow();
  const tests: Record<View, (task: ConsoleTask) => boolean> = {
    mine: (task) => task.status === "open" && task.assigneeUid === user?.uid,
    overdue: (task) => dueState(task, now) === "overdue",
    week: (task) => task.status === "open" && Boolean(task.dueAt) && Date.parse(task.dueAt!) - now < 7 * 86_400_000,
    open: (task) => task.status === "open",
    done: (task) => task.status === "done",
  };
  const all = tasks.rows;
  const counts = useMemo(() => Object.fromEntries((Object.keys(tests) as View[]).map((key) => [key, (all ?? []).filter(tests[key]).length])), [all, user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(
    () => (all ? all.filter((task) => tests[view](task) && matches(search, task.title, studioById(task.tenantId)?.name, task.assigneeEmail)) : null),
    [all, view, search, studioById, user?.uid], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const subjectLink = (task: ConsoleTask) => {
    if (!task.subjectKey) return <span className="cx-dim">—</span>;
    const [kind, id] = task.subjectKey.split(/:(.+)/);
    if (kind === "studio" && id) return <Link className="cx-link" href={studioHref(id)} onClick={(event) => event.stopPropagation()}>{studioById(id)?.name ?? id}</Link>;
    if (kind === "person" && id) return <Link className="cx-link" href={personHref(id)} onClick={(event) => event.stopPropagation()}>Person</Link>;
    if (kind === "issue" && id) return <Link className="cx-link" href={`/platform-admin/issues/${id}`} onClick={(event) => event.stopPropagation()}>Issue</Link>;
    return <span className="cx-dim">—</span>;
  };

  const columns = useMemo<ColumnDef<ConsoleTask, unknown>[]>(
    () => [
      {
        id: "done",
        header: "",
        enableSorting: false,
        meta: { width: 40 },
        cell: ({ row }) => (
          <input
            aria-label={row.original.status === "done" ? `Reopen ${row.original.title}` : `Complete ${row.original.title}`}
            checked={row.original.status === "done"}
            className="cx-checkbox"
            disabled={!can("crm.write")}
            onChange={() => void run("updateTask", { taskId: row.original.id, status: row.original.status === "done" ? "open" : "done" }, { done: row.original.status === "done" ? "Task reopened." : "Task done." })}
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />
        ),
      },
      {
        id: "title",
        header: "Task",
        accessorFn: (task) => task.title ?? "",
        meta: { width: 260, flex: true },
        cell: ({ row }) => <span className="cx-strong" style={{ textDecoration: row.original.status === "done" ? "line-through" : undefined }}>{row.original.title}</span>,
      },
      { id: "subject", header: "For", accessorFn: (task) => studioById(task.tenantId)?.name ?? task.subjectKey ?? "", meta: { width: 200 }, cell: ({ row }) => subjectLink(row.original) },
      {
        id: "due",
        header: "Due",
        accessorFn: (task) => task.dueAt ?? "9999",
        meta: { width: 130 },
        cell: ({ row }) => {
          const state = dueState(row.original, now);
          if (row.original.status === "done") return <span className="cx-dim">Done {relative(row.original.completedAt)}</span>;
          if (!row.original.dueAt) return <span className="cx-dim">No date</span>;
          return state === "overdue" ? <Pill tone="bad">Overdue · {shortDate(row.original.dueAt)}</Pill> : state === "today" ? <Pill tone="warn">Today</Pill> : shortDate(row.original.dueAt);
        },
      },
      { id: "owner", header: "Owner", accessorFn: (task) => task.assigneeEmail ?? "", meta: { width: 200, priority: 2 }, cell: ({ row }) => (row.original.assigneeUid === user?.uid ? "Me" : (row.original.assigneeEmail ?? "—")) },
      { id: "created", header: "Added", accessorFn: (task) => task.createdAt ?? "", meta: { width: 96, priority: 3 }, cell: ({ row }) => relative(row.original.createdAt) },
      {
        id: "menu",
        header: "",
        enableSorting: false,
        meta: { width: 44 },
        cell: ({ row }) =>
          can("crm.write") && row.original.status === "open" ? (
            <ActionMenu
              iconOnly
              items={[
                { label: "Snooze a day", onSelect: () => void run("updateTask", { taskId: row.original.id, dueAt: new Date(Math.max(Date.now(), Date.parse(row.original.dueAt ?? "") || 0) + 86_400_000).toISOString() }, { done: "Snoozed a day." }) },
                { label: "Snooze a week", onSelect: () => void run("updateTask", { taskId: row.original.id, dueAt: new Date(Math.max(Date.now(), Date.parse(row.original.dueAt ?? "") || 0) + 7 * 86_400_000).toISOString() }, { done: "Snoozed a week." }) },
                { label: "Clear the due date", onSelect: () => void run("updateTask", { taskId: row.original.id, dueAt: null }, { done: "Due date cleared." }) },
              ]}
              label={`Actions for ${row.original.title}`}
            />
          ) : null,
      },
    ],
    [can, run, studioById, user?.uid], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const tabs: Array<{ key: View; label: string }> = [
    { key: "mine", label: "Mine" },
    { key: "overdue", label: "Overdue" },
    { key: "week", label: "Due this week" },
    { key: "open", label: "All open" },
    { key: "done", label: "Done" },
  ];

  return (
    <>
      <Topbar crumbs={[{ label: "CRM" }, { label: "Tasks" }]}>
        {can("crm.write") ? (
          <Button onClick={() => setCreating(true)} variant="primary">
            <Plus size={13} /> New task
          </Button>
        ) : null}
      </Topbar>
      <div className="cx-content">
        <PageHead count={counts.open ?? null} title="Tasks" />
        <Tabs
          label="Task views"
          onChange={(key) => {
            const next = new URLSearchParams(params.toString());
            if (key === "mine") next.delete("view");
            else next.set("view", key);
            router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
          }}
          tabs={tabs.map((tab) => ({ ...tab, count: all ? counts[tab.key] : null }))}
          value={view}
        />
        <FilterBar>
          <SearchInput id="task-search" onChange={setSearch} placeholder="Filter by task or studio" value={search} />
        </FilterBar>
        <DataTable
          columns={columns}
          empty={<Empty title={view === "mine" ? "Nothing on your list" : "No tasks here"}>Add tasks from a studio, a person, or with New task.</Empty>}
          getRowId={(task) => task.id}
          initialSort={[{ id: "due", desc: false }]}
          label="Tasks"
          mobile={(task) => ({ title: task.title, end: task.dueAt ? shortDate(task.dueAt) : undefined, meta: studioById(task.tenantId)?.name ?? "" })}
          onRowClick={(task) => task.tenantId && router.push(studioHref(task.tenantId))}
          rows={rows}
        />
      </div>
      <TaskDialog onClose={() => setCreating(false)} open={creating} subjectKeys={[]} />
    </>
  );
}
