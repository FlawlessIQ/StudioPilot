"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { humanize, relative, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { ConfirmDialog } from "../overlay";
import { Button, Empty, Notice, PageHead, Pill, Tabs } from "../ui";
import { useCommand } from "../use-command";

/**
 * Data requests (docs/console.md): studios' exports and deletion requests.
 * A deletion waits out a 30-day cooling-off and needs a completed export
 * before the platform can approve it (docs/security.md).
 */
type Deletion = { id: string; tenantId: string; status: string; requestedAt?: string; createdAt?: string; coolingOffEndsAt?: string; platformApprovedAt?: string; approvalReason?: string };
type Export = { id: string; tenantId: string; status: string; createdAt?: string; completedAt?: string; requestedBy?: string };

export function DataRequestsPage() {
  const router = useRouter();
  const { studioById, can } = useConsole();
  const { run, busy } = useCommand();
  const [tab, setTab] = useState<"deletions" | "exports">("deletions");
  const [approving, setApproving] = useState<Deletion | null>(null);
  const deletions = useLiveQuery<Deletion>("data:deletions", (firestore) => query(collection(firestore, "deletionRequests"), limit(500)));
  const exports = useLiveQuery<Export>("data:exports", (firestore) => query(collection(firestore, "exportJobs"), limit(500)));
  const exportDone = (tenantId: string) => (exports.rows ?? []).some((item) => item.tenantId === tenantId && item.status === "complete");
  const name = (tenantId: string) => studioById(tenantId)?.name ?? tenantId;

  const deletionColumns = useMemo<ColumnDef<Deletion, unknown>[]>(
    () => [
      { id: "studio", header: "Studio", accessorFn: (row) => name(row.tenantId), meta: { width: 220, flex: true }, cell: ({ row }) => <span className="cx-strong">{name(row.original.tenantId)}</span> },
      { id: "status", header: "Status", accessorFn: (row) => row.status, meta: { width: 140 }, cell: ({ row }) => <Pill tone={row.original.status === "cooling_off" ? "warn" : row.original.status === "platform_approved" ? "info" : "neutral"}>{humanize(row.original.status)}</Pill> },
      { id: "requested", header: "Requested", accessorFn: (row) => row.requestedAt ?? row.createdAt ?? "", meta: { width: 120 }, cell: ({ row }) => relative(row.original.requestedAt ?? row.original.createdAt) },
      { id: "cooling", header: "Cooling-off ends", accessorFn: (row) => row.coolingOffEndsAt ?? "", meta: { width: 140, priority: 2 }, cell: ({ row }) => (row.original.coolingOffEndsAt ? shortDate(row.original.coolingOffEndsAt) : "—") },
      { id: "export", header: "Export", accessorFn: (row) => (exportDone(row.tenantId) ? 1 : 0), meta: { width: 120 }, cell: ({ row }) => (exportDone(row.original.tenantId) ? <Pill tone="ok">Complete</Pill> : <Pill tone="warn">Not yet</Pill>) },
      {
        id: "approve",
        header: "",
        enableSorting: false,
        meta: { width: 100 },
        cell: ({ row }) =>
          can("deletion.approve") && row.original.status === "cooling_off" ? (
            <Button
              disabled={!exportDone(row.original.tenantId)}
              onClick={(event) => {
                event.stopPropagation();
                setApproving(row.original);
              }}
              size="sm"
              title={exportDone(row.original.tenantId) ? undefined : "Needs a completed export first"}
            >
              Approve
            </Button>
          ) : null,
      },
    ],
    [can, exports.rows, studioById], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const exportColumns = useMemo<ColumnDef<Export, unknown>[]>(
    () => [
      { id: "studio", header: "Studio", accessorFn: (row) => name(row.tenantId), meta: { width: 220, flex: true }, cell: ({ row }) => <span className="cx-strong">{name(row.original.tenantId)}</span> },
      { id: "status", header: "Status", accessorFn: (row) => row.status, meta: { width: 120 }, cell: ({ row }) => <Pill tone={row.original.status === "complete" ? "ok" : row.original.status === "failed" ? "bad" : "info"}>{humanize(row.original.status)}</Pill> },
      { id: "created", header: "Requested", accessorFn: (row) => row.createdAt ?? "", meta: { width: 120 }, cell: ({ row }) => relative(row.original.createdAt) },
      { id: "completed", header: "Completed", accessorFn: (row) => row.completedAt ?? "", meta: { width: 120 }, cell: ({ row }) => (row.original.completedAt ? relative(row.original.completedAt) : "—") },
    ],
    [studioById], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const waiting = (deletions.rows ?? []).filter((row) => row.status === "cooling_off");

  return (
    <>
      <Topbar crumbs={[{ label: "System" }, { label: "Data requests" }]} />
      <div className="cx-content">
        <PageHead count={waiting.length} title="Data requests" />
        <p className="cx-page-intro">A studio that asks to be deleted waits 30 days, and the platform approves only once its export is complete. Approving starts the deletion; it can&apos;t be undone.</p>
        {deletions.error ? <Notice tone="bad">{deletions.error}</Notice> : null}
        <Tabs
          label="Request types"
          onChange={setTab}
          tabs={[
            { key: "deletions" as const, label: "Deletions", count: deletions.rows?.length ?? null },
            { key: "exports" as const, label: "Exports", count: exports.rows?.length ?? null },
          ]}
          value={tab}
        />
        {tab === "deletions" ? (
          <DataTable columns={deletionColumns} empty={<Empty title="No deletion requests" />} getRowId={(row) => row.id} label="Deletion requests" onRowClick={(row) => router.push(studioHref(row.tenantId))} rows={deletions.rows} />
        ) : (
          <DataTable columns={exportColumns} empty={<Empty title="No exports" />} getRowId={(row) => row.id} label="Exports" onRowClick={(row) => router.push(studioHref(row.tenantId))} rows={exports.rows} />
        )}
      </div>
      <ConfirmDialog
        busy={busy === "approveDeletion"}
        confirmLabel="Approve deletion"
        confirmName={approving ? name(approving.tenantId) : null}
        danger
        description={approving ? `${name(approving.tenantId)} and everything in it will be deleted. Their export is complete. This can't be undone.` : ""}
        onClose={() => setApproving(null)}
        onConfirm={async ({ reason, confirmName }) => {
          if (!approving) return;
          const result = await run("approveDeletion", { requestId: approving.id, reason, confirmName }, { done: "Deletion approved." });
          if (result) setApproving(null);
        }}
        open={approving !== null}
        title="Approve deletion"
      />
    </>
  );
}
