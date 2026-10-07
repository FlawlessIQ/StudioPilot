"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { isAtRisk, moveDirection, playFor, riskOrder, type LifecycleEvent } from "@/features/console/lifecycle";
import { LIFECYCLE_LABELS, LIFECYCLE_TONES, type ConsoleStudio, type LifecycleStage } from "@/features/console/model";
import { daysUntil, relative } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { TaskDialog } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { Button, Empty, Health, Notice, PageHead, Panel, Pill, Segments, Stat, StatStrip, Tabs } from "../ui";

/**
 * Lifecycle (docs/console.md, "Lifecycle"): the studios slipping, the trials
 * about to end, and who moved between stages. Each studio at risk comes with
 * one play (features/console/lifecycle.ts): what to do, where, and the task to
 * write if it can't be done now.
 */

const VIEWS = [
  { key: "risk", label: "At risk" },
  { key: "trials", label: "Trials" },
  { key: "moves", label: "Moves, 30 days" },
] as const;
type View = (typeof VIEWS)[number]["key"];

const COUNTED: LifecycleStage[] = ["setting_up", "stalled", "activated", "paying", "at_risk"];

export function LifecyclePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { studios, can } = useConsole();
  const now = useNow();
  const view = (VIEWS.find((item) => item.key === params.get("view"))?.key ?? "risk") as View;
  const since = useMemo(() => new Date(now - 30 * 86_400_000).toISOString().slice(0, 10), [now]);
  const events = useLiveQuery<LifecycleEvent>(`lifecycle:events:${since}`, (firestore) =>
    query(collection(firestore, "consoleLifecycleEvents"), where("at", ">=", since), orderBy("at", "desc"), limit(500)),
  );
  const [tasking, setTasking] = useState<{ studio: ConsoleStudio; title: string } | null>(null);

  const all = (studios.rows ?? []).filter((studio) => !studio.removed);
  const atRisk = all.filter(isAtRisk).sort(riskOrder(now));
  const trials = all
    .filter((studio) => studio.subscriptionStatus === "trialing" && !studio.comped)
    .sort((a, b) => (daysUntil(a.trialEndsAt, now) ?? 99) - (daysUntil(b.trialEndsAt, now) ?? 99));
  const churned30 = (events.rows ?? []).filter((event) => event.to === "churned").length;
  const activated30 = (events.rows ?? []).filter((event) => event.to === "activated" || (event.to === "paying" && event.from !== "at_risk")).length;

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const riskColumns = useMemo<ColumnDef<ConsoleStudio, unknown>[]>(
    () => [
      { id: "name", header: "Studio", accessorFn: (row) => row.name, meta: { width: 200, flex: true }, cell: ({ row }) => <span className="cx-strong">{row.original.name}</span> },
      { id: "stage", header: "Stage", accessorFn: (row) => row.lifecycle, meta: { width: 110 }, cell: ({ row }) => <Pill tone={LIFECYCLE_TONES[row.original.lifecycle]}>{LIFECYCLE_LABELS[row.original.lifecycle]}</Pill> },
      { id: "health", header: "Health", accessorFn: (row) => row.health?.score ?? 100, meta: { width: 90, align: "right" }, cell: ({ row }) => <Health band={row.original.health.band} score={row.original.health.score} /> },
      {
        id: "play",
        header: "What to do",
        accessorFn: (row) => playFor(row)?.action ?? "",
        meta: { width: 320, priority: 2 },
        cell: ({ row }) => playFor(row.original)?.action ?? <span className="cx-sub">Nothing specific: open the record.</span>,
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { width: 170, align: "right" },
        cell: ({ row }) => {
          const play = playFor(row.original);
          return (
            <span className="cx-row-actions">
              <Link className="cx-btn" data-size="sm" href={studioHref(row.original.tenantId, play?.tab ?? undefined)} onClick={(event) => event.stopPropagation()}>
                Open
              </Link>
              {can("crm.write") ? (
                <Button
                  onClick={(event) => {
                    event.stopPropagation();
                    setTasking({ studio: row.original, title: play?.task ?? `Check in with ${row.original.name}` });
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Task
                </Button>
              ) : null}
            </span>
          );
        },
      },
    ],
    [can],
  );

  const trialColumns = useMemo<ColumnDef<ConsoleStudio, unknown>[]>(
    () => [
      { id: "name", header: "Studio", accessorFn: (row) => row.name, meta: { width: 200, flex: true }, cell: ({ row }) => <span className="cx-strong">{row.original.name}</span> },
      {
        id: "ends",
        header: "Trial ends",
        accessorFn: (row) => daysUntil(row.trialEndsAt, now) ?? 99,
        meta: { width: 110 },
        cell: ({ row }) => {
          const days = daysUntil(row.original.trialEndsAt, now);
          return days === null ? "—" : <Pill tone={days <= 3 ? "warn" : "neutral"}>{days <= 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</Pill>;
        },
      },
      { id: "setup", header: "Setup", accessorFn: (row) => row.setupDone, meta: { width: 130 }, cell: ({ row }) => <Segments done={row.original.setupDone} /> },
      { id: "jobs", header: "Jobs", accessorFn: (row) => row.jobs.total, meta: { width: 70, align: "right", priority: 2 } },
      { id: "active", header: "Last active", accessorFn: (row) => row.lastActiveAt ?? row.lastSignInAt ?? "", meta: { width: 120, priority: 3 }, cell: ({ row }) => relative(row.original.lastActiveAt ?? row.original.lastSignInAt, now) },
      { id: "stage", header: "Stage", accessorFn: (row) => row.lifecycle, meta: { width: 110, priority: 2 }, cell: ({ row }) => <Pill tone={LIFECYCLE_TONES[row.original.lifecycle]}>{LIFECYCLE_LABELS[row.original.lifecycle]}</Pill> },
    ],
    [now],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Customers" }, { label: "Lifecycle" }]} />
      <div className="cx-content">
        <PageHead title="Lifecycle">
          <StatStrip>
            {COUNTED.map((stage) => (
              <Stat key={stage} label={LIFECYCLE_LABELS[stage]} tone={stage === "at_risk" || stage === "stalled" ? (all.some((studio) => studio.lifecycle === stage) ? "warn" : undefined) : undefined} value={all.filter((studio) => studio.lifecycle === stage && !studio.comped).length} />
            ))}
            <Stat label="Moved up, 30d" tone={activated30 ? "ok" : undefined} value={activated30} />
            <Stat label="Churned, 30d" tone={churned30 ? "bad" : undefined} value={churned30} />
          </StatStrip>
        </PageHead>
        <Tabs label="Lifecycle views" onChange={(key) => set("view", key === "risk" ? null : key)} tabs={VIEWS.map((item) => ({ key: item.key, label: item.label, count: item.key === "risk" ? atRisk.length : item.key === "trials" ? trials.length : events.rows?.length ?? null }))} value={view} />
        {events.error ? <Notice tone="bad">{events.error}</Notice> : null}
        {view === "risk" ? (
          <DataTable
            columns={riskColumns}
            empty={<Empty title="Nobody is at risk">No stalled setups, failed payments or quiet studios right now.</Empty>}
            getRowId={(row) => row.tenantId}
            label="Studios at risk"
            mobile={(row) => ({ title: row.name, end: <Health band={row.health.band} score={row.health.score} />, meta: playFor(row)?.action ?? LIFECYCLE_LABELS[row.lifecycle] })}
            onRowClick={(row) => router.push(studioHref(row.tenantId, playFor(row)?.tab ?? undefined))}
            rows={studios.rows ? atRisk : null}
          />
        ) : null}
        {view === "trials" ? (
          <DataTable
            columns={trialColumns}
            empty={<Empty title="No studios in a trial" />}
            getRowId={(row) => row.tenantId}
            initialSort={[{ id: "ends", desc: false }]}
            label="Studios in a trial"
            mobile={(row) => ({ title: row.name, end: `${daysUntil(row.trialEndsAt, now) ?? "—"}d`, meta: `Setup ${row.setupDone} of 6 · ${row.jobs.total} jobs` })}
            onRowClick={(row) => router.push(studioHref(row.tenantId))}
            rows={studios.rows ? trials : null}
          />
        ) : null}
        {view === "moves" ? (
          <Panel flush>
            {events.rows === null ? (
              <Empty title="Loading…" />
            ) : events.rows.length ? (
              <div className="cx-timeline">
                {events.rows.map((event) => {
                  const direction = moveDirection(event);
                  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
                  return (
                    <Link className="cx-item" href={studioHref(event.tenantId)} key={event.id}>
                      <span className="cx-item-lead">
                        <Arrow aria-label={direction === "up" ? "Better" : direction === "down" ? "Worse" : "Sideways"} size={14} />
                      </span>
                      <span className="cx-item-title">{event.name ?? event.tenantId}</span>
                      <span className="cx-item-time">{relative(event.at, now)}</span>
                      <span className="cx-item-snippet">{`${LIFECYCLE_LABELS[event.from] ?? event.from} → ${LIFECYCLE_LABELS[event.to] ?? event.to}`}</span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <Empty title="No moves recorded yet">Moves are recorded from October 7, 2026, as the rollup sees a studio change stage.</Empty>
            )}
          </Panel>
        ) : null}
      </div>
      <TaskDialog
        defaultTitle={tasking?.title}
        onClose={() => setTasking(null)}
        open={Boolean(tasking)}
        subjectKeys={tasking ? [`studio:${tasking.studio.tenantId}`] : []}
        subjectLabel={tasking?.studio.name}
      />
    </>
  );
}
