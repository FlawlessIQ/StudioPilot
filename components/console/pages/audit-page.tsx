"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, limit, orderBy, query, where } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { Download } from "lucide-react";
import { dateTime, humanize } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { downloadCsv, studioHref, toCsv } from "@/lib/console/studio-display";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { FilterBar, SearchInput, matches } from "../filters";
import { Drawer } from "../overlay";
import { Button, Empty, KV, Notice, PageHead, Pill, Tabs } from "../ui";

/**
 * Audit log (docs/console.md): what happened, who did it and why. Console
 * actions carry the admin's role and written reason; studio and provider
 * events sit beside them. Read-only; nothing here can be edited.
 */
type Event = {
  id: string;
  tenantId?: string;
  actorId?: string;
  actorType?: string;
  actorEmail?: string | null;
  actorRole?: string | null;
  action?: string;
  entityType?: string;
  entityId?: string;
  reason?: string | null;
  timestamp?: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
};

type View = "admin" | "billing" | "support" | "all";

export function AuditPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { studioById } = useConsole();
  const view = (["admin", "billing", "support", "all"].includes(params.get("view") ?? "") ? params.get("view") : "admin") as View;
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Event | null>(null);
  const events = useLiveQuery<Event>(`audit:${view}`, (firestore) => {
    const base = collection(firestore, "auditEvents");
    if (view === "admin") return query(base, where("actorType", "==", "platform_admin"), orderBy("timestamp", "desc"), limit(500));
    if (view === "billing") return query(base, where("entityType", "==", "subscription"), orderBy("timestamp", "desc"), limit(500));
    if (view === "support") return query(base, where("entityType", "==", "support_access"), orderBy("timestamp", "desc"), limit(500));
    return query(base, orderBy("timestamp", "desc"), limit(500));
  });
  const studioName = (tenantId?: string) => (!tenantId || tenantId === "platform" ? "Platform" : (studioById(tenantId)?.name ?? tenantId));
  const rows = useMemo(
    () => (events.rows ? events.rows.filter((event) => matches(search, event.action, event.actorEmail, event.reason, studioName(event.tenantId), event.entityId)) : null),
    [events.rows, search, studioById], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const columns = useMemo<ColumnDef<Event, unknown>[]>(
    () => [
      { id: "time", header: "Time", accessorFn: (event) => event.timestamp ?? "", meta: { width: 160 }, cell: ({ row }) => dateTime(row.original.timestamp) },
      {
        id: "actor",
        header: "Actor",
        accessorFn: (event) => event.actorEmail ?? event.actorType ?? "",
        meta: { width: 200 },
        cell: ({ row }) => (
          <span className="cx-name-text">
            <b>{row.original.actorEmail ?? humanize(row.original.actorType ?? "")}</b>
            {row.original.actorRole ? <small>{humanize(row.original.actorRole)}</small> : null}
          </span>
        ),
      },
      { id: "action", header: "Action", accessorFn: (event) => event.action ?? "", meta: { width: 220, flex: true }, cell: ({ row }) => <span className="cx-mono">{row.original.action}</span> },
      { id: "studio", header: "Studio", accessorFn: (event) => studioName(event.tenantId), meta: { width: 170, priority: 2 }, cell: ({ row }) => studioName(row.original.tenantId) },
      { id: "reason", header: "Reason", accessorFn: (event) => event.reason ?? "", meta: { width: 240, priority: 3 }, cell: ({ row }) => (row.original.reason ? <span title={row.original.reason}>{row.original.reason}</span> : <span className="cx-dim">—</span>) },
    ],
    [studioById], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const set = (key: View) => {
    const next = new URLSearchParams(params.toString());
    if (key === "admin") next.delete("view");
    else next.set("view", key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  return (
    <>
      <Topbar crumbs={[{ label: "Platform" }, { label: "Audit log" }]}>
        <Button
          disabled={!rows?.length}
          onClick={() =>
            rows &&
            downloadCsv(
              `studiocue-audit-${view}-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(
                ["Time", "Actor", "Role", "Action", "Studio", "Target", "Reason", "IP"],
                rows.map((event) => [event.timestamp, event.actorEmail ?? event.actorType, event.actorRole, event.action, studioName(event.tenantId), `${event.entityType ?? ""}:${event.entityId ?? ""}`, event.reason, event.ipAddress]),
              ),
            )
          }
        >
          <Download size={13} /> Export CSV
        </Button>
      </Topbar>
      <div className="cx-content">
        <PageHead title="Audit log" />
        {events.error ? <Notice tone="bad">{events.error}</Notice> : null}
        <Tabs
          label="Audit views"
          onChange={set}
          tabs={[
            { key: "admin" as const, label: "Console actions" },
            { key: "billing" as const, label: "Billing changes" },
            { key: "support" as const, label: "Support access" },
            { key: "all" as const, label: "Everything" },
          ]}
          value={view}
        />
        <FilterBar>
          <SearchInput id="audit-search" onChange={setSearch} placeholder="Filter by action, person, studio or reason" value={search} />
        </FilterBar>
        <DataTable
          columns={columns}
          empty={<Empty title="Nothing recorded in this view" />}
          getRowId={(event) => event.id}
          label="Audit events"
          mobile={(event) => ({ title: event.action, end: <Pill dot={false}>{studioName(event.tenantId)}</Pill>, meta: `${dateTime(event.timestamp)} · ${event.actorEmail ?? event.actorType}` })}
          onRowClick={setOpen}
          pageSize={100}
          rows={rows}
        />
      </div>
      <Drawer onClose={() => setOpen(null)} open={Boolean(open)} title={open?.action ?? "Event"} wide>
        {open ? (
          <>
            <KV
              items={[
                ["When", dateTime(open.timestamp)],
                ["Actor", `${open.actorEmail ?? open.actorId ?? "—"} (${humanize(open.actorType ?? "")}${open.actorRole ? `, ${humanize(open.actorRole)}` : ""})`],
                ["Studio", open.tenantId && open.tenantId !== "platform" ? <a className="cx-link" href={studioHref(open.tenantId)} key="s">{studioName(open.tenantId)}</a> : "Platform"],
                ["Target", `${humanize(open.entityType ?? "")} · ${open.entityId ?? ""}`],
                ["Reason", open.reason ?? "—"],
                ["From", [open.ipAddress, open.userAgent].filter(Boolean).join(" · ") || "—"],
              ]}
            />
            <span className="cx-section-label">Before</span>
            <pre className="cx-code-block">{JSON.stringify(open.before ?? null, null, 2)}</pre>
            <span className="cx-section-label">After</span>
            <pre className="cx-code-block">{JSON.stringify(open.after ?? null, null, 2)}</pre>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
