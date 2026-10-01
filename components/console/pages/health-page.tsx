"use client";

import { useMemo } from "react";
import Link from "next/link";
import { collection, limit, limitToLast, orderBy, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { humanize, relative } from "@/lib/console/format";
import { useLiveDoc, useLiveQuery } from "@/lib/console/live";
import { useJobs } from "@/lib/console/jobs";
import { useNow } from "@/lib/console/use-now";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { Empty, KV, Notice, PageHead, Panel, Pill, Stat, StatStrip } from "../ui";

/**
 * System health (docs/console.md): the background queues against their
 * objectives (operationsHealthScheduler, every 15 minutes), email delivery,
 * webhook arrivals, and the Console's own rollup. Everything shown is a
 * stored check with its time; nothing here is estimated.
 */
type Health = {
  id: string;
  category?: string;
  component?: string;
  status?: string;
  checkedAt?: string;
  message?: string | null;
  backlog?: number;
  deadLetters?: number;
  oldestAgeSeconds?: number;
  objective?: { maxBacklog?: number; maxOldestAgeSeconds?: number } | null;
};

type Webhook = { id: string; provider?: string; type?: string; status?: string; createdAt?: string };

const tone = (status?: string) => (status === "healthy" ? "ok" : status === "critical" ? "bad" : status === "degraded" ? "warn" : "neutral");

export function HealthPage() {
  const queues = useLiveQuery<Health>("health:queues", (firestore) => query(collection(firestore, "systemHealth"), where("category", "==", "background_queue")));
  const integrations = useLiveQuery<Health>("health:integrations", (firestore) => query(collection(firestore, "systemHealth"), where("category", "==", "integration"), limit(1000)));
  const webhooks = useLiveQuery<Webhook>("health:webhooks", (firestore) => query(collection(firestore, "webhookEvents"), orderBy("createdAt"), limitToLast(300)));
  const rollup = useLiveDoc<{ lastRunAt?: string; studios?: number; people?: number; failures?: string[] }>("consoleSettings/rollup");
  const failed = useJobs("failed");
  const now = useNow();

  const emailFailures = (failed.rows ?? []).filter((job) => job.collection === "emailJobs" && !job.dismissedAt);
  const lastByProvider = useMemo(() => {
    const map = new Map<string, Webhook & { count24h: number; ignored: number }>();
    const since = now - 86_400_000;
    for (const event of webhooks.rows ?? []) {
      const provider = event.provider ?? event.id.split("_")[0] ?? "unknown";
      const current = map.get(provider);
      const recent = event.createdAt && Date.parse(event.createdAt) >= since ? 1 : 0;
      if (!current || (event.createdAt ?? "") > (current.createdAt ?? "")) map.set(provider, { ...event, provider, count24h: (current?.count24h ?? 0) + recent, ignored: (current?.ignored ?? 0) + (event.status === "ignored" ? 1 : 0) });
      else {
        current.count24h += recent;
        if (event.status === "ignored") current.ignored += 1;
      }
    }
    return [...map.values()].sort((a, b) => (a.provider ?? "").localeCompare(b.provider ?? ""));
  }, [webhooks.rows, now]);

  const queueColumns: ColumnDef<Health, unknown>[] = [
    { id: "queue", header: "Queue", accessorFn: (row) => row.component ?? row.id, meta: { width: 180, flex: true }, cell: ({ row }) => <span className="cx-strong">{humanize(row.original.component ?? row.original.id)}</span> },
    { id: "status", header: "Status", accessorFn: (row) => row.status ?? "", meta: { width: 110 }, cell: ({ row }) => <Pill tone={tone(row.original.status)}>{humanize(row.original.status ?? "unknown")}</Pill> },
    { id: "backlog", header: "Waiting", accessorFn: (row) => row.backlog ?? 0, meta: { width: 90, align: "right" }, cell: ({ row }) => row.original.backlog ?? 0 },
    { id: "dead", header: "Failed", accessorFn: (row) => row.deadLetters ?? 0, meta: { width: 90, align: "right" }, cell: ({ row }) => <span className={row.original.deadLetters ? "cx-strong" : undefined}>{row.original.deadLetters ?? 0}</span> },
    {
      id: "oldest",
      header: "Oldest waiting",
      accessorFn: (row) => row.oldestAgeSeconds ?? 0,
      meta: { width: 130, align: "right" },
      cell: ({ row }) => {
        const seconds = row.original.oldestAgeSeconds ?? 0;
        return seconds ? (seconds >= 3600 ? `${Math.round(seconds / 3600)}h` : seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`) : <span className="cx-dim">—</span>;
      },
    },
    { id: "checked", header: "Checked", accessorFn: (row) => row.checkedAt ?? "", meta: { width: 100, priority: 2 }, cell: ({ row }) => relative(row.original.checkedAt) },
  ];

  const integrationRows = integrations.rows ?? [];
  const degraded = integrationRows.filter((row) => row.status === "degraded").length;
  const untested = integrationRows.filter((row) => row.status === "unknown").length;
  const breached = (queues.rows ?? []).filter((row) => row.status && row.status !== "healthy").length;
  const rollupAge = rollup.data?.lastRunAt ? now - Date.parse(rollup.data.lastRunAt) : null;

  return (
    <>
      <Topbar crumbs={[{ label: "Operations" }, { label: "System health" }]} />
      <div className="cx-content">
        <PageHead title="System health">
          <StatStrip>
            <Stat label="Queues off target" tone={breached ? "bad" : "ok"} value={queues.rows ? breached : "…"} />
            <Stat label="Failed emails" tone={emailFailures.length ? "bad" : "ok"} value={failed.rows ? emailFailures.length : "…"} />
            <Stat label="Integrations in error" tone={degraded ? "bad" : "ok"} value={integrations.rows ? degraded : "…"} />
            <Stat label="Console rows" tone={rollupAge !== null && rollupAge > 45 * 60_000 ? "warn" : undefined} value={rollup.data?.lastRunAt ? relative(rollup.data.lastRunAt) : "never"} />
          </StatStrip>
        </PageHead>
        {rollupAge !== null && rollupAge > 45 * 60_000 ? (
          <Notice title="The Console's rows are stale" tone="warn">
            The rollup last ran {relative(rollup.data?.lastRunAt)}. It should run every 15 minutes; check consoleRollupScheduler and its invoker binding.
          </Notice>
        ) : null}
        <DataTable columns={queueColumns} empty={<Empty title="No queue checks yet">They&apos;re written every 15 minutes by the operations health scheduler.</Empty>} getRowId={(row) => row.id} label="Background queues" rows={queues.rows} />
        <div className="cx-grid-2">
          <Panel actions={<Link className="cx-link" href="/platform-admin/jobs?view=attention">Jobs</Link>} title="Email delivery">
            <KV
              items={[
                ["Failed, not dismissed", String(emailFailures.length)],
                ["Most recent failure", emailFailures[0] ? `${relative(emailFailures[0].failedAt)} · ${emailFailures[0].errorCode}` : "None"],
              ]}
            />
          </Panel>
          <Panel actions={<Link className="cx-link" href="/platform-admin/integrations?view=problems">Integrations</Link>} title="Integrations">
            <KV items={[["Checked", String(integrationRows.length)], ["In error", String(degraded)], ["Not yet tested", String(untested)]]} />
          </Panel>
          <Panel flush title="Webhooks received">
            {lastByProvider.length ? (
              <div className="cx-table-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table aria-label="Webhooks by provider" className="cx-table">
                  <thead>
                    <tr>
                      <th className="cx-th">Provider</th>
                      <th className="cx-th">Last received</th>
                      <th className="cx-th" data-align="right">Today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastByProvider.map((row) => (
                      <tr className="cx-row" key={row.provider}>
                        <td className="cx-td cx-strong">{humanize(row.provider)}</td>
                        <td className="cx-td">{relative(row.createdAt)} <span className="cx-sub">· {humanize(row.type ?? "")}</span></td>
                        <td className="cx-td" data-align="right">{row.count24h}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No webhooks recorded" />
            )}
          </Panel>
          <Panel title="Console rollup">
            <KV
              items={[
                ["Last run", rollup.data?.lastRunAt ? relative(rollup.data.lastRunAt) : "Never"],
                ["Studios", String(rollup.data?.studios ?? "—")],
                ["People", String(rollup.data?.people ?? "—")],
                ["Failures", rollup.data?.failures?.length ? rollup.data.failures.join(", ") : "None"],
              ]}
            />
            <span className="cx-hint">Deployed-function freshness isn&apos;t visible from here. Run scripts/verify-deployed-function-freshness.sh after every functions deploy.</span>
          </Panel>
        </div>
      </div>
    </>
  );
}
