"use client";

import { TRADES, TRADE_LABELS, tradeOf } from "@/features/trades/trades";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { Download, RefreshCw } from "lucide-react";
import {
  LIFECYCLE_LABELS,
  LIFECYCLE_STAGES,
  LIFECYCLE_TONES,
  PLAN_LABELS,
  SUBSCRIPTION_STATUS,
  type ConsoleStudio,
} from "@/features/console/model";
import { daysUntil, money, relative } from "@/lib/console/format";
import { billingMomentText, downloadCsv, planLabel, studioHref, subscriptionBadge, toCsv } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { EmailStudioDialog, TagsDialog, TaskDialog } from "../crm-dialogs";
import { DataTable } from "../data-table";
import { BulkBar, ChipSelect, FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { Button, Empty, Health, NameCell, Notice, PageHead, Pill, Segments, Stat, StatStrip, Tabs, When } from "../ui";
import { useCommand } from "../use-command";
import { Dialog } from "../overlay";
import { useSavedViews } from "@/lib/console/saved-views";
import { BillingDialogs, useBillingDialogs } from "../billing-dialogs";

/**
 * Studios: every studio as a CRM account (docs/console.md). One row per
 * `consoleStudios` document; the view tabs, chips and search decide which.
 */

type View = "all" | "trialing" | "ending" | "risk" | "setup" | "past_due" | "comped" | "churned" | "suspended";

const DAY = 86_400_000;

export const STUDIO_VIEWS: Array<{ key: View; label: string; test: (studio: ConsoleStudio, now: number) => boolean }> = [
  { key: "all", label: "All", test: (studio) => studio.lifecycle !== "churned" },
  { key: "trialing", label: "Trialing", test: (studio) => studio.subscriptionStatus === "trialing" && !studio.comped },
  {
    key: "ending",
    label: "Trial ends ≤7d",
    test: (studio, now) => {
      const days = daysUntil(studio.trialEndsAt, now);
      return studio.subscriptionStatus === "trialing" && days !== null && days >= 0 && days <= 7;
    },
  },
  { key: "risk", label: "At risk", test: (studio) => studio.lifecycle === "at_risk" || studio.lifecycle === "stalled" },
  { key: "setup", label: "Not set up", test: (studio) => studio.setupDone < 3 && !["churned", "suspended"].includes(studio.lifecycle) },
  { key: "past_due", label: "Past due", test: (studio) => studio.subscriptionStatus === "past_due" || studio.subscriptionStatus === "unpaid" || studio.subscriptionStatus === "paused" },
  { key: "comped", label: "Comped", test: (studio) => studio.comped },
  { key: "churned", label: "Churned", test: (studio) => studio.lifecycle === "churned" },
  { key: "suspended", label: "Suspended", test: (studio) => studio.suspended },
];

export function StudiosPage() {
  const { studios, can } = useConsole();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (STUDIO_VIEWS.some((item) => item.key === params.get("view")) ? params.get("view") : "all") as View;
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState<string>("");
  const [trade, setTrade] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [lifecycle, setLifecycle] = useState<string>("");
  const [tag, setTag] = useState<string>("");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const saved = useSavedViews("studios");
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const filtersNow = { view, plan, trade, status, lifecycle, tag, search };
  const filtered = Boolean(plan || status || lifecycle || tag || search);
  const applySaved = (filters: Record<string, string>) => {
    setPlan(filters.plan ?? "");
    setTrade(filters.trade ?? "");
    setStatus(filters.status ?? "");
    setLifecycle(filters.lifecycle ?? "");
    setTag(filters.tag ?? "");
    setSearch(filters.search ?? "");
    setView((filters.view as View) ?? "all");
  };
  const [dialog, setDialog] = useState<null | { kind: "email" | "task" | "tags"; ids: string[] }>(null);
  const { run, busy } = useCommand();
  const billing = useBillingDialogs();
  const now = useNow();

  const all = studios.rows;
  const counts = useMemo(
    () => Object.fromEntries(STUDIO_VIEWS.map((item) => [item.key, (all ?? []).filter((studio) => item.test(studio, now)).length])),
    // `now` moves every render; counts only need the rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all],
  );
  const tags = useMemo(() => [...new Set((all ?? []).flatMap((studio) => studio.tags ?? []))].sort(), [all]);
  const rows = useMemo(() => {
    if (!all) return null;
    const test = STUDIO_VIEWS.find((item) => item.key === view)!.test;
    return all.filter(
      (studio) =>
        test(studio, now) &&
        (!plan || studio.plan === plan) &&
        (!trade || tradeOf(studio.trade) === trade) &&
        (!status || (status === "comped" ? studio.comped : studio.subscriptionStatus === status)) &&
        (!lifecycle || studio.lifecycle === lifecycle) &&
        (!tag || (studio.tags ?? []).includes(tag)) &&
        matches(search, studio.name, studio.ownerName, studio.ownerEmail, studio.slug, studio.tenantId, studio.legalName),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, view, plan, trade, status, lifecycle, tag, search]);

  const stats = useMemo(() => {
    const list = all ?? [];
    return {
      mrr: list.reduce((sum, studio) => sum + (studio.mrrCents || 0), 0),
      trialing: list.filter((studio) => studio.subscriptionStatus === "trialing" && !studio.comped).length,
      ending: counts.ending ?? 0,
      pastDue: counts.past_due ?? 0,
      signups: list.filter((studio) => studio.createdAt && now - Date.parse(studio.createdAt) <= 30 * DAY).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, counts]);

  const selectedIds = Object.keys(selection).filter((id) => selection[id]);
  const selectedStudios = (all ?? []).filter((studio) => selectedIds.includes(studio.tenantId));
  const dialogStudios = dialog ? (all ?? []).filter((studio) => dialog.ids.includes(studio.tenantId)) : [];

  const setView = (next: View) => {
    const query = new URLSearchParams(params.toString());
    if (next === "all") query.delete("view");
    else query.set("view", next);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
    setSelection({});
  };

  const exportRows = (list: ConsoleStudio[]) =>
    downloadCsv(
      `studiocue-studios-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        ["Studio", "Owner", "Owner email", "Lifecycle", "Plan", "Cadence", "Subscription", "Comped", "MRR", "Trial ends", "Period end", "Setup", "Jobs", "Seats", "Last active", "Health", "Tags", "Signed up", "Tenant id"],
        list.map((studio) => [
          studio.name,
          studio.ownerName,
          studio.ownerEmail,
          LIFECYCLE_LABELS[studio.lifecycle],
          studio.plan ? (PLAN_LABELS[studio.plan] ?? studio.plan) : "",
          studio.cadence,
          studio.subscriptionStatus,
          studio.comped ? "yes" : "",
          (studio.mrrCents / 100).toFixed(2),
          studio.trialEndsAt,
          studio.currentPeriodEnd,
          `${studio.setupDone}/6`,
          studio.jobs.total,
          studio.seats.internal,
          studio.lastActiveAt ?? studio.lastSignInAt,
          studio.health.band === "none" ? "" : studio.health.score,
          (studio.tags ?? []).join(" "),
          studio.createdAt,
          studio.tenantId,
        ]),
      ),
    );

  const columns = useMemo<ColumnDef<ConsoleStudio, unknown>[]>(
    () => [
      {
        id: "studio",
        header: "Studio",
        accessorFn: (studio) => studio.name.toLowerCase(),
        meta: { width: 220, flex: true },
        cell: ({ row }) => <NameCell name={row.original.name} sub={[row.original.ownerName, row.original.ownerEmail].filter(Boolean).join(" · ") || "No owner on record"} />,
      },
      {
        id: "lifecycle",
        header: "Lifecycle",
        accessorFn: (studio) => LIFECYCLE_STAGES.indexOf(studio.lifecycle),
        meta: { width: 112, priority: 5 },
        cell: ({ row }) => <Pill tone={LIFECYCLE_TONES[row.original.lifecycle]}>{LIFECYCLE_LABELS[row.original.lifecycle]}</Pill>,
      },
      {
        id: "trade",
        header: "Trade",
        accessorFn: (studio) => TRADE_LABELS[tradeOf(studio.trade)],
        meta: { width: 104, priority: 4 },
      },
      {
        id: "plan",
        header: "Plan",
        accessorFn: (studio) => `${studio.plan ?? ""}${studio.cadence ?? ""}`,
        meta: { width: 132 },
        cell: ({ row }) => (
          // The code goes under the plan: beside it, "Multi-Brand · mo" and a
          // code chip don't fit the column and the chip gets cut off.
          <span className="cx-name-text">
            <span>{planLabel(row.original.plan, row.original.cadence)}</span>
            {row.original.discount?.code ? <small>{row.original.discount.code}</small> : null}
          </span>
        ),
      },
      {
        id: "subscription",
        header: "Subscription",
        accessorFn: (studio) => (studio.comped ? "comped" : (studio.subscriptionStatus ?? "")),
        meta: { width: 118 },
        cell: ({ row }) => {
          const badge = subscriptionBadge(row.original.subscriptionStatus, row.original.comped);
          return row.original.suspended ? <Pill tone="bad">Suspended</Pill> : <Pill tone={badge.tone}>{badge.label}</Pill>;
        },
      },
      {
        id: "mrr",
        header: "MRR",
        accessorFn: (studio) => studio.mrrCents,
        meta: { width: 80, align: "right", priority: 3 },
        cell: ({ row }) => <span className={row.original.mrrCents ? undefined : "cx-dim"}>{money(row.original.mrrCents)}</span>,
      },
      {
        id: "moment",
        header: "Trial / renews",
        accessorFn: (studio) => studio.billingMoment?.at ?? "9999",
        meta: { width: 142 },
        cell: ({ row }) => {
          const moment = billingMomentText(row.original.billingMoment, now);
          return <span className={moment.urgent ? "cx-strong" : moment.text === "—" ? "cx-dim" : undefined}>{moment.text}</span>;
        },
      },
      {
        id: "setup",
        header: "Setup",
        accessorFn: (studio) => studio.setupDone,
        meta: { width: 116, priority: 6 },
        cell: ({ row }) => <Segments done={row.original.setupDone} />,
      },
      { id: "jobs", header: "Jobs", accessorFn: (studio) => studio.jobs.total, meta: { width: 58, align: "right", priority: 8 }, cell: ({ row }) => row.original.jobs.total },
      { id: "seats", header: "Seats", accessorFn: (studio) => studio.seats.internal, meta: { width: 60, align: "right", priority: 9 }, cell: ({ row }) => row.original.seats.internal },
      {
        id: "active",
        header: "Last active",
        accessorFn: (studio) => studio.lastActiveAt ?? studio.lastSignInAt ?? "",
        meta: { width: 96, priority: 4 },
        cell: ({ row }) => <When at={row.original.lastActiveAt ?? row.original.lastSignInAt} />,
      },
      {
        id: "health",
        header: "Health",
        accessorFn: (studio) => (studio.health.band === "none" ? -1 : studio.health.score),
        meta: { width: 84, priority: 7 },
        cell: ({ row }) => <Health band={row.original.health.band} />,
      },
      {
        id: "menu",
        header: "",
        enableSorting: false,
        meta: { width: 44 },
        cell: ({ row }) => (
          <ActionMenu
            iconOnly
            items={[
              { label: "Open", onSelect: () => router.push(studioHref(row.original.tenantId)) },
              ...(can("crm.write")
                ? [
                    { label: "Email owner…", onSelect: () => setDialog({ kind: "email", ids: [row.original.tenantId] }) },
                    { label: "Add task…", onSelect: () => setDialog({ kind: "task", ids: [row.original.tenantId] }) },
                    { label: "Tags…", onSelect: () => setDialog({ kind: "tags", ids: [row.original.tenantId] }) },
                  ]
                : []),
              ...billing.menuItems(row.original),
            ]}
            label={`Actions for ${row.original.name}`}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, router, billing.menuItems],
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Customers" }, { label: "Studios" }]}>
        <Button busy={busy === "refreshAll"} onClick={() => void run("refreshAll", {}, { done: "Studio and people rows refreshed." })} variant="ghost">
          <RefreshCw size={13} />
          Refresh
        </Button>
        <Button disabled={!rows?.length} onClick={() => rows && exportRows(rows)}>
          <Download size={13} />
          Export CSV
        </Button>
      </Topbar>
      <div className="cx-content">
        <PageHead count={all?.filter((studio) => studio.lifecycle !== "churned").length ?? null} title="Studios">
          <StatStrip>
            <Stat label="MRR" value={money(stats.mrr)} />
            <Stat active={view === "trialing"} label="Trialing" onClick={() => setView("trialing")} value={stats.trialing} />
            <Stat active={view === "ending"} label="Trial ends ≤7d" onClick={() => setView("ending")} tone={stats.ending ? "warn" : undefined} value={stats.ending} />
            <Stat active={view === "past_due"} label="Past due" onClick={() => setView("past_due")} tone={stats.pastDue ? "bad" : undefined} value={stats.pastDue} />
            <Stat label="Signups, 30d" value={stats.signups} />
          </StatStrip>
        </PageHead>

        {studios.offline ? <Notice title="Live data is off">This environment runs in mock mode, so no studios are read.</Notice> : null}
        {studios.error ? <Notice tone="bad">{studios.error}</Notice> : null}

        <Tabs
          label="Studio views"
          onChange={setView}
          tabs={STUDIO_VIEWS.filter((item) => item.key !== "suspended" || (counts.suspended ?? 0) > 0).map((item) => ({ key: item.key, label: item.label, count: all ? counts[item.key] : null }))}
          value={view}
        />
        {saved.views.length || filtered ? (
          <div className="cx-inline" style={{ flexWrap: "wrap" }}>
            {saved.views.length ? <span className="cx-section-label">Saved</span> : null}
            {saved.views.map((item) => (
              <span className="cx-chip" data-active={JSON.stringify(item.filters) === JSON.stringify(filtersNow) ? "true" : undefined} key={item.id}>
                <button className="cx-link" onClick={() => applySaved(item.filters)} style={{ color: "inherit" }} type="button">
                  {item.name}
                </button>
                <button aria-label={`Remove saved view ${item.name}`} className="cx-link" onClick={() => saved.remove(item.id)} style={{ color: "inherit" }} type="button">
                  ×
                </button>
              </span>
            ))}
            {filtered ? (
              <Button onClick={() => setNaming(true)} size="sm" variant="ghost">
                + Save this view
              </Button>
            ) : null}
          </div>
        ) : null}

        {selectedIds.length ? (
          <BulkBar count={selectedIds.length} onClear={() => setSelection({})}>
            {can("crm.write") ? (
              <>
                <button className="cx-btn" onClick={() => setDialog({ kind: "email", ids: selectedIds })} type="button">
                  Email owners
                </button>
                <button className="cx-btn" onClick={() => setDialog({ kind: "tags", ids: selectedIds })} type="button">
                  Add tags
                </button>
                <button className="cx-btn" onClick={() => setDialog({ kind: "task", ids: selectedIds })} type="button">
                  Create tasks
                </button>
              </>
            ) : null}
            {billing.bulkButton(selectedStudios)}
            <button className="cx-btn" onClick={() => exportRows(selectedStudios)} type="button">
              Export
            </button>
          </BulkBar>
        ) : (
          <FilterBar>
            <SearchInput id="studio-search" onChange={setSearch} placeholder="Filter by studio, owner or email" value={search} />
            <ChipSelect label="Trade" onChange={setTrade} options={TRADES.map((value) => ({ value, label: TRADE_LABELS[value] }))} value={trade} />
            <ChipSelect label="Plan" onChange={setPlan} options={Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))} value={plan} />
            <ChipSelect
              label="Subscription"
              onChange={setStatus}
              options={[...Object.entries(SUBSCRIPTION_STATUS).map(([value, item]) => ({ value, label: item.label })), { value: "comped", label: "Comped" }]}
              value={status}
            />
            <ChipSelect label="Lifecycle" onChange={setLifecycle} options={LIFECYCLE_STAGES.map((value) => ({ value, label: LIFECYCLE_LABELS[value] }))} value={lifecycle} />
            {tags.length ? <ChipSelect label="Tag" onChange={setTag} options={tags.map((value) => ({ value, label: value }))} value={tag} /> : null}
          </FilterBar>
        )}

        <DataTable
          columns={columns}
          empty={
            all && all.length === 0 ? (
              <Empty action={<Button onClick={() => void run("refreshAll", {}, { done: "Studio and people rows refreshed." })}>Build the rows now</Button>} title="No studio rows yet">
                The rows are built every 15 minutes. Build them now to see every studio.
              </Empty>
            ) : (
              <Empty title="No studios match">Try another view, or clear the filters.</Empty>
            )
          }
          footer={all?.length ? <span>Rows refresh every 15 minutes · last {relative(all.map((studio) => studio.refreshedAt).sort().at(-1))}</span> : null}
          getRowId={(studio) => studio.tenantId}
          initialSort={[{ id: "active", desc: true }]}
          label="Studios"
          mobile={(studio) => {
            const badge = subscriptionBadge(studio.subscriptionStatus, studio.comped);
            return {
              title: studio.name,
              end: <Pill tone={studio.suspended ? "bad" : badge.tone}>{studio.suspended ? "Suspended" : badge.label}</Pill>,
              meta: [LIFECYCLE_LABELS[studio.lifecycle], planLabel(studio.plan, studio.cadence), `setup ${studio.setupDone}/6`, relative(studio.lastActiveAt ?? studio.lastSignInAt)].join(" · "),
            };
          }}
          onRowClick={(studio) => router.push(studioHref(studio.tenantId))}
          onSelectionChange={setSelection}
          rows={rows}
          selectable={can("crm.write") || can("billing.write")}
          selection={selection}
        />
      </div>

      <EmailStudioDialog onClose={() => setDialog(null)} open={dialog?.kind === "email"} studios={dialogStudios} />
      <TaskDialog
        onClose={() => setDialog(null)}
        open={dialog?.kind === "task"}
        subjectKeys={(dialog?.ids ?? []).map((id) => `studio:${id}`)}
        subjectLabel={dialogStudios.length === 1 ? dialogStudios[0]?.name : undefined}
      />
      <TagsDialog current={dialogStudios.length === 1 ? (dialogStudios[0]?.tags ?? []) : []} onClose={() => setDialog(null)} open={dialog?.kind === "tags"} tenantIds={dialog?.ids ?? []} />
      <BillingDialogs state={billing} />
      <Dialog
        footer={
          <>
            <Button onClick={() => setNaming(false)} variant="ghost">Cancel</Button>
            <Button
              disabled={!viewName.trim()}
              onClick={() => {
                saved.save(viewName.trim(), filtersNow);
                setNaming(false);
                setViewName("");
              }}
              variant="primary"
            >
              Save view
            </Button>
          </>
        }
        onClose={() => setNaming(false)}
        open={naming}
        title="Save this view"
      >
        <div className="cx-field">
          <label className="cx-label" htmlFor="saved-view-name">Name</label>
          <input className="cx-input" id="saved-view-name" maxLength={40} onChange={(event) => setViewName(event.target.value)} placeholder="Pilot trials ending soon" value={viewName} />
          <span className="cx-hint">Saved in this browser. It keeps the tab, filters and search you have now.</span>
        </div>
      </Dialog>
    </>
  );
}
