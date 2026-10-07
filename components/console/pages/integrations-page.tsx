"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { humanize, relative } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { EmailStudioDialog } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { ChipSelect, FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { Empty, PageHead, Pill, Stat, StatStrip, Tabs } from "../ui";

/**
 * Integrations (docs/console.md): every studio's connected apps, one row per
 * connection, and a matrix of studios against providers.
 */
type Connection = {
  id: string;
  tenantId: string;
  provider: string;
  status?: string;
  accountLabel?: string;
  providerAccountName?: string;
  providerAccountId?: string;
  lastError?: string | null;
  lastHealthCheckAt?: string | null;
  lastHealthLatencyMs?: number | null;
  archivedAt?: string | null;
  updatedAt?: string;
};

const healthy = (connection: Connection) => connection.status === "connected";

export function IntegrationsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { studioById, studios, can } = useConsole();
  const view = (["all", "problems", "matrix"].includes(params.get("view") ?? "") ? params.get("view") : "all") as "all" | "problems" | "matrix";
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("");
  const [emailTenant, setEmailTenant] = useState<string | null>(null);
  const connections = useLiveQuery<Connection>("console:integrations", (firestore) => query(collection(firestore, "integrationConnections"), limit(2000)));
  const live = useMemo(() => (connections.rows ?? []).filter((connection) => !connection.archivedAt), [connections.rows]);
  const providers = useMemo(() => [...new Set(live.map((connection) => connection.provider))].sort(), [live]);
  const rows = useMemo(
    () =>
      connections.rows
        ? live.filter(
            (connection) =>
              (view !== "problems" || !healthy(connection)) &&
              (!provider || connection.provider === provider) &&
              matches(search, studioById(connection.tenantId)?.name, connection.provider, connection.lastError),
          )
        : null,
    [connections.rows, live, view, provider, search, studioById],
  );
  const set = (value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null) next.delete("view");
    else next.set("view", value);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const columns = useMemo<ColumnDef<Connection, unknown>[]>(
    () => [
      { id: "studio", header: "Studio", accessorFn: (connection) => studioById(connection.tenantId)?.name ?? connection.tenantId, meta: { width: 200, flex: true }, cell: ({ row }) => <span className="cx-strong">{studioById(row.original.tenantId)?.name ?? row.original.tenantId}</span> },
      { id: "provider", header: "Provider", accessorFn: (connection) => connection.provider, meta: { width: 150 }, cell: ({ row }) => humanize(row.original.provider) },
      { id: "account", header: "Account", accessorFn: (connection) => connection.accountLabel ?? connection.providerAccountName ?? "", meta: { width: 180, priority: 3 }, cell: ({ row }) => row.original.accountLabel ?? row.original.providerAccountName ?? row.original.providerAccountId ?? <span className="cx-dim">—</span> },
      { id: "status", header: "Status", accessorFn: (connection) => connection.status ?? "", meta: { width: 120 }, cell: ({ row }) => <Pill tone={healthy(row.original) ? "ok" : "bad"}>{humanize(row.original.status ?? "unknown")}</Pill> },
      {
        id: "checked",
        header: "Last checked",
        accessorFn: (connection) => connection.lastHealthCheckAt ?? "",
        meta: { width: 120, priority: 2 },
        cell: ({ row }) => (row.original.lastHealthCheckAt ? relative(row.original.lastHealthCheckAt) : <span className="cx-dim">Not tested</span>),
      },
      { id: "error", header: "Last error", accessorFn: (connection) => connection.lastError ?? "", meta: { width: 240, priority: 4 }, cell: ({ row }) => (row.original.lastError ? <span className="cx-mono" title={row.original.lastError}>{row.original.lastError}</span> : <span className="cx-dim">—</span>) },
      {
        id: "menu",
        header: "",
        enableSorting: false,
        meta: { width: 44 },
        cell: ({ row }) => (
          <ActionMenu
            iconOnly
            items={[
              { label: "Open studio", onSelect: () => router.push(studioHref(row.original.tenantId, "integrations")) },
              ...(can("crm.write") && !healthy(row.original) ? [{ label: "Email studio to reconnect…", onSelect: () => setEmailTenant(row.original.tenantId) }] : []),
            ]}
            label="Integration actions"
          />
        ),
      },
    ],
    [can, router, studioById],
  );

  const problems = live.filter((connection) => !healthy(connection));
  const matrixStudios = (studios.rows ?? []).filter((studio) => live.some((connection) => connection.tenantId === studio.tenantId)).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <Topbar crumbs={[{ label: "System" }, { label: "Integrations" }]} />
      <div className="cx-content">
        <PageHead title="Integrations">
          <StatStrip>
            <Stat label="Connections" value={live.length} />
            <Stat label="With a problem" tone={problems.length ? "bad" : "ok"} value={problems.length} />
            <Stat label="Studios connected" value={new Set(live.map((connection) => connection.tenantId)).size} />
            <Stat label="Providers" value={providers.length} />
          </StatStrip>
        </PageHead>
        <Tabs
          label="Integration views"
          onChange={(key) => set(key === "all" ? null : key)}
          tabs={[
            { key: "all" as const, label: "All", count: connections.rows ? live.length : null },
            { key: "problems" as const, label: "Problems", count: connections.rows ? problems.length : null },
            { key: "matrix" as const, label: "Matrix" },
          ]}
          value={view}
        />
        {view === "matrix" ? (
          matrixStudios.length ? (
            <div className="cx-table-wrap">
              <div className="cx-table-scroll">
                <table aria-label="Studios against providers" className="cx-table" style={{ minWidth: 200 + providers.length * 110 }}>
                  <thead>
                    <tr>
                      <th className="cx-th" style={{ width: 220 }}>Studio</th>
                      {providers.map((item) => (
                        <th className="cx-th" key={item} style={{ textAlign: "center" }}>{humanize(item)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixStudios.map((studio) => (
                      <tr className="cx-row" data-clickable="true" key={studio.tenantId} onClick={() => router.push(studioHref(studio.tenantId, "integrations"))}>
                        <td className="cx-td cx-strong">{studio.name}</td>
                        {providers.map((item) => {
                          const connection = live.find((candidate) => candidate.tenantId === studio.tenantId && candidate.provider === item);
                          return (
                            <td className="cx-td" key={item} style={{ textAlign: "center" }} title={connection ? `${humanize(connection.status ?? "unknown")}${connection.lastError ? `: ${connection.lastError}` : ""}` : "Not connected"}>
                              <span className="cx-matrix-dot" data-tone={connection ? (healthy(connection) ? "ok" : "bad") : undefined} />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cx-table-foot">
                <span className="cx-legend">
                  <span><span className="cx-matrix-dot" data-tone="ok" /> Connected</span>
                  <span><span className="cx-matrix-dot" data-tone="bad" /> Problem</span>
                  <span><span className="cx-matrix-dot" /> Not connected</span>
                </span>
              </div>
            </div>
          ) : (
            <Empty title="No studio has connected an app yet" />
          )
        ) : (
          <>
            <FilterBar>
              <SearchInput id="integration-search" onChange={setSearch} placeholder="Filter by studio, provider or error" value={search} />
              <ChipSelect label="Provider" onChange={setProvider} options={providers.map((value) => ({ value, label: humanize(value) }))} value={provider} />
            </FilterBar>
            <DataTable
              columns={columns}
              empty={<Empty title={view === "problems" ? "No problems" : "No connections"}>{view === "problems" ? "Every connected app is working." : ""}</Empty>}
              getRowId={(connection) => connection.id}
              label="Integrations"
              mobile={(connection) => ({ title: studioById(connection.tenantId)?.name ?? connection.tenantId, end: <Pill tone={healthy(connection) ? "ok" : "bad"}>{humanize(connection.status ?? "unknown")}</Pill>, meta: humanize(connection.provider) })}
              onRowClick={(connection) => router.push(studioHref(connection.tenantId, "integrations"))}
              rows={rows}
            />
          </>
        )}
      </div>
      <EmailStudioDialog
        onClose={() => setEmailTenant(null)}
        open={emailTenant !== null}
        preset={{
          subject: "Please reconnect an integration in StudioCue",
          body: "One of your connected apps has stopped working with StudioCue.\nOpen Integrations and reconnect it. Anything waiting will go through once it's connected again.",
          actionPath: "/studio/integrations",
        }}
        studios={(emailTenant ? [studioById(emailTenant)] : []).filter((studio): studio is NonNullable<typeof studio> => Boolean(studio))}
      />
    </>
  );
}
