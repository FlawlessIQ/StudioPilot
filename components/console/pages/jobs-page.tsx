"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { explainJobError } from "@/features/console/job-errors";
import { dateTime, humanize, relative } from "@/lib/console/format";
import { JOB_QUEUES, toJobRow, useJobs, type JobRow } from "@/lib/console/jobs";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { EmailStudioDialog } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { BulkBar, ChipSelect, FilterBar, SearchInput, matches } from "../filters";
import { ConfirmDialog, Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Pill, Stat, StatStrip, Tabs } from "../ui";
import { useCommand } from "../use-command";

/**
 * Jobs (docs/console.md): background work that failed, grouped by cause, with
 * what fixes each cause in plain words and whether a rerun can. Rerun runs the
 * job again for real; it never marks a provider call as done.
 */
type View = "attention" | "retrying" | "recent" | "dismissed";

function useRecentJobs(enabled: boolean) {
  const [rows, setRows] = useState<JobRow[] | null>(null);
  useEffect(() => {
    if (!enabled || !dataIsLive) return;
    const { firestore } = getFirebaseClient();
    const parts: Record<string, JobRow[]> = {};
    // Most recent jobs per queue, newest first.
    const recent = JOB_QUEUES.map((queue) =>
      onSnapshot(
        query(collection(firestore, queue.collection), orderBy("createdAt", "desc"), limit(40)),
        (snapshot) => {
          parts[queue.collection] = snapshot.docs.map((doc) => toJobRow(queue.collection, doc.id, doc.data()));
          setRows(Object.values(parts).flat().sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
        },
        () => {
          parts[queue.collection] = [];
        },
      ),
    );
    return () => recent.forEach((unsubscribe) => unsubscribe());
  }, [enabled]);
  return rows;
}

export function JobsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can, studioById } = useConsole();
  const { run, busy } = useCommand();
  const view = (["attention", "retrying", "recent", "dismissed"].includes(params.get("view") ?? "") ? params.get("view") : "attention") as View;
  const failed = useJobs("failed");
  const retrying = useJobs("retrying");
  const recent = useRecentJobs(view === "recent");
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [dismissing, setDismissing] = useState<JobRow[] | null>(null);
  const [detail, setDetail] = useState<JobRow | null>(null);
  const [emailTenant, setEmailTenant] = useState<string | null>(null);

  const source = view === "retrying" ? retrying.rows : view === "recent" ? recent : failed.rows;
  const rows = useMemo(() => {
    if (!source) return null;
    return source.filter(
      (job) =>
        (view === "dismissed" ? Boolean(job.dismissedAt) : view === "attention" ? !job.dismissedAt : true) &&
        (!queue || job.collection === queue) &&
        matches(search, job.type, job.errorCode, job.errorMessage, studioById(job.tenantId)?.name),
    );
  }, [source, view, queue, search, studioById]);
  const groups = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const job of rows ?? []) map.set(job.errorCode, [...(map.get(job.errorCode) ?? []), job]);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  const attention = (failed.rows ?? []).filter((job) => !job.dismissedAt);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    setSelection({});
  };
  const rerun = (jobs: JobRow[]) =>
    jobs.length === 1
      ? run("rerunJob", { collectionName: jobs[0]!.collection, jobId: jobs[0]!.id }, { done: "Rerun queued." })
      : run<{ rerun: number; refused: unknown[] }>("bulkRerun", { jobs: jobs.map((job) => ({ collectionName: job.collection, jobId: job.id })) }, { done: (result) => `${result.rerun} rerun${result.refused.length ? `, ${result.refused.length} couldn't be` : ""}.` });

  const columns = useMemo<ColumnDef<JobRow, unknown>[]>(
    () => [
      { id: "type", header: "Job", accessorFn: (job) => job.type, meta: { width: 220, flex: true }, cell: ({ row }) => <span className="cx-strong">{humanize(row.original.type)}</span> },
      {
        id: "studio",
        header: "Studio",
        accessorFn: (job) => studioById(job.tenantId)?.name ?? job.tenantId ?? "",
        meta: { width: 180 },
        cell: ({ row }) =>
          row.original.tenantId && row.original.tenantId !== "platform" ? (
            <Link className="cx-link" href={studioHref(row.original.tenantId)} onClick={(event) => event.stopPropagation()}>
              {studioById(row.original.tenantId)?.name ?? row.original.tenantId}
            </Link>
          ) : (
            <span className="cx-dim">Platform</span>
          ),
      },
      { id: "queue", header: "Queue", accessorFn: (job) => job.queueLabel, meta: { width: 96, priority: 3 }, cell: ({ row }) => row.original.queueLabel },
      ...(grouped ? [] : [{ id: "error", header: "Error", accessorFn: (job: JobRow) => job.errorCode, meta: { width: 220 }, cell: ({ row }: { row: { original: JobRow } }) => <span className="cx-mono">{row.original.errorCode}</span> } as ColumnDef<JobRow, unknown>]),
      { id: "attempts", header: "Tries", accessorFn: (job) => job.attempts, meta: { width: 64, align: "right", priority: 4 }, cell: ({ row }) => row.original.attempts },
      { id: "when", header: view === "recent" ? "Created" : "Failed", accessorFn: (job) => (view === "recent" ? job.createdAt : job.failedAt) ?? "", meta: { width: 100 }, cell: ({ row }) => relative(view === "recent" ? row.original.createdAt : row.original.failedAt) },
      {
        id: "status",
        header: "Status",
        accessorFn: (job) => job.status,
        meta: { width: 110, priority: 2 },
        cell: ({ row }) => (row.original.dismissedAt ? <Pill>Dismissed</Pill> : <Pill tone={["dead_letter", "failed", "processing_failed"].includes(row.original.status) ? "bad" : row.original.status === "succeeded" ? "ok" : "info"}>{humanize(row.original.status)}</Pill>),
      },
      {
        id: "rerun",
        header: "",
        enableSorting: false,
        meta: { width: 74 },
        cell: ({ row }) =>
          can("ops.write") && ["dead_letter", "failed", "processing_failed"].includes(row.original.status) ? (
            <Button
              onClick={(event) => {
                event.stopPropagation();
                void rerun([row.original]);
              }}
              size="sm"
            >
              Rerun
            </Button>
          ) : null,
      },
    ],
    [can, grouped, studioById, view], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const selectedJobs = (rows ?? []).filter((job) => selection[job.key]);

  return (
    <>
      <Topbar crumbs={[{ label: "Operations" }, { label: "Jobs" }]} />
      <div className="cx-content">
        <PageHead title="Jobs">
          <StatStrip>
            <Stat label="Need attention" tone={attention.length ? "bad" : "ok"} value={failed.rows ? attention.length : "…"} />
            <Stat label="Retrying" value={retrying.rows?.length ?? "…"} />
            <Stat label="Causes" value={new Set(attention.map((job) => job.errorCode)).size} />
            <Stat label="Studios affected" value={new Set(attention.map((job) => job.tenantId).filter(Boolean)).size} />
          </StatStrip>
        </PageHead>
        {failed.error ? <Notice tone="warn">{failed.error}</Notice> : null}
        <Tabs
          label="Job views"
          onChange={(key) => set("view", key === "attention" ? null : key)}
          tabs={[
            { key: "attention" as const, label: "Needs attention", count: failed.rows ? attention.length : null },
            { key: "retrying" as const, label: "Retrying", count: retrying.rows?.length ?? null },
            { key: "recent" as const, label: "Recent jobs" },
            { key: "dismissed" as const, label: "Dismissed", count: failed.rows ? failed.rows.length - attention.length : null },
          ]}
          value={view}
        />
        {selectedJobs.length ? (
          <BulkBar count={selectedJobs.length} onClear={() => setSelection({})}>
            <button className="cx-btn" onClick={() => void rerun(selectedJobs).then(() => setSelection({}))} type="button">Rerun</button>
            <button className="cx-btn" onClick={() => setDismissing(selectedJobs)} type="button">Dismiss</button>
          </BulkBar>
        ) : (
          <FilterBar
            end={
              view === "attention" || view === "dismissed" ? (
                <label className="cx-check cx-hint">
                  <input checked={grouped} onChange={(event) => setGrouped(event.target.checked)} type="checkbox" />
                  Group by cause
                </label>
              ) : undefined
            }
          >
            <SearchInput id="job-search" onChange={setSearch} placeholder="Filter by job, error or studio" value={search} />
            <ChipSelect label="Queue" onChange={setQueue} options={JOB_QUEUES.map((item) => ({ value: item.collection, label: item.label }))} value={queue as JobRow["collection"] | ""} />
          </FilterBar>
        )}

        {grouped && (view === "attention" || view === "dismissed") ? (
          rows === null ? (
            <DataTable columns={columns} getRowId={(job) => job.key} label="Jobs" rows={null} />
          ) : groups.length ? (
            groups.map(([code, jobs]) => {
              const advice = explainJobError(code, jobs[0]?.errorMessage);
              const tenants = [...new Set(jobs.map((job) => job.tenantId).filter((id): id is string => Boolean(id) && id !== "platform"))];
              const isOpen = open[code] ?? groups.length <= 3;
              return (
                <section className="cx-group" data-open={isOpen ? "true" : "false"} key={code}>
                  <div className="cx-group-head">
                    <button aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${code} jobs`} className="cx-btn" data-icon="true" data-size="sm" data-variant="ghost" onClick={() => setOpen((current) => ({ ...current, [code]: !isOpen }))} style={{ gridRow: "1 / 3" }} type="button">
                      <ChevronRight className="cx-group-chev" size={14} />
                    </button>
                    <span className="cx-group-title">
                      <span className="cx-mono cx-strong">{code}</span>
                      <span className="cx-sub">
                        {jobs.length} {jobs.length === 1 ? "job" : "jobs"} · {tenants.length === 1 ? (studioById(tenants[0])?.name ?? tenants[0]) : `${tenants.length} studios`}
                      </span>
                      {advice.rerunHelps ? <Pill tone="info">Rerun usually works</Pill> : advice.studioFixes ? <Pill tone="warn">Studio needs to act</Pill> : advice.oursToFix ? <Pill tone="bad">Ours to fix</Pill> : null}
                    </span>
                    <p className="cx-group-desc">
                      {advice.cause} {advice.advice}
                    </p>
                    {can("ops.write") && view === "attention" ? (
                      <span className="cx-group-actions">
                        {advice.studioFixes && tenants.length === 1 && can("crm.write") ? <Button onClick={() => setEmailTenant(tenants[0]!)} size="sm">Email studio</Button> : null}
                        <Button busy={busy === "bulkRerun"} onClick={() => void rerun(jobs)} size="sm">
                          Rerun {jobs.length > 1 ? "all" : ""}
                        </Button>
                        <Button onClick={() => setDismissing(jobs)} size="sm" variant="ghost">
                          Dismiss
                        </Button>
                      </span>
                    ) : null}
                  </div>
                  {isOpen ? (
                    <DataTable columns={columns} getRowId={(job) => job.key} label={`${code} jobs`} onRowClick={setDetail} pageSize={25} rows={jobs} />
                  ) : null}
                </section>
              );
            })
          ) : (
            <Empty title={view === "attention" ? "Nothing needs attention" : "Nothing dismissed"}>{view === "attention" ? "No background job is stuck." : ""}</Empty>
          )
        ) : (
          <DataTable
            columns={columns}
            empty={<Empty title="No jobs here" />}
            getRowId={(job) => job.key}
            label="Jobs"
            mobile={(job) => ({ title: humanize(job.type), end: <Pill tone="bad">{job.errorCode}</Pill>, meta: `${studioById(job.tenantId)?.name ?? "Platform"} · ${relative(job.failedAt)}` })}
            onRowClick={setDetail}
            onSelectionChange={setSelection}
            rows={rows}
            selectable={can("ops.write") && view !== "recent"}
            selection={selection}
          />
        )}
      </div>

      <ConfirmDialog
        busy={busy === "dismissJob"}
        confirmLabel={dismissing && dismissing.length > 1 ? `Dismiss ${dismissing.length} jobs` : "Dismiss job"}
        description="Takes them off Needs attention without running them. The jobs and their errors stay as they are, under Dismissed."
        onClose={() => setDismissing(null)}
        onConfirm={async ({ reason }) => {
          if (!dismissing) return;
          const result = await run("dismissJob", { jobs: dismissing.map((job) => ({ collectionName: job.collection, jobId: job.id })), reason }, { done: dismissing.length > 1 ? `${dismissing.length} jobs dismissed.` : "Job dismissed." });
          if (result) {
            setDismissing(null);
            setSelection({});
          }
        }}
        open={dismissing !== null}
        reasonPlaceholder="e.g. The couple's job was deleted; nothing to send."
        title="Dismiss"
      />
      <Drawer onClose={() => setDetail(null)} open={Boolean(detail)} title={detail ? humanize(detail.type) : ""} wide>
        {detail ? (
          <>
            <Notice title={explainJobError(detail.errorCode, detail.errorMessage).cause} tone="warn">
              {explainJobError(detail.errorCode, detail.errorMessage).advice}
            </Notice>
            <KV
              items={[
                ["Studio", studioById(detail.tenantId)?.name ?? detail.tenantId ?? "Platform"],
                ["Queue", `${detail.queueLabel} (${detail.collection})`],
                ["Status", humanize(detail.status)],
                ["Tries", String(detail.attempts)],
                ["Error", <span className="cx-mono" key="e">{detail.errorMessage || detail.errorCode}</span>],
                ["Created", dateTime(detail.createdAt)],
                ["Failed", dateTime(detail.failedAt)],
                detail.dismissedAt ? ["Dismissed", `${dateTime(detail.dismissedAt)}${detail.dismissReason ? ` · “${detail.dismissReason}”` : ""}`] : null,
                ["Id", <span className="cx-mono" key="i">{detail.id}</span>],
              ]}
            />
            <span className="cx-section-label">Record</span>
            <pre className="cx-code-block">{JSON.stringify(redact(detail.raw), null, 2)}</pre>
          </>
        ) : null}
      </Drawer>
      <EmailStudioDialog
        onClose={() => setEmailTenant(null)}
        open={emailTenant !== null}
        preset={{
          subject: "Please reconnect an integration in StudioCue",
          body: "One of your connected apps has stopped working with StudioCue, so some work for your clients couldn't be finished.\nOpen Integrations in StudioCue and reconnect it. Anything waiting will go through once it's connected again.",
          actionPath: "/studio/integrations",
        }}
        studios={(emailTenant ? [studioById(emailTenant)] : []).filter((studio): studio is NonNullable<typeof studio> => Boolean(studio))}
      />
    </>
  );
}

/** Job documents can carry message bodies and tokens; show their shape, not their secrets. */
function redact(value: Record<string, unknown>): Record<string, unknown> {
  const hidden = /token|secret|password|authorization|body|html|text|content/i;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hidden.test(key) ? "[hidden]" : item]));
}
