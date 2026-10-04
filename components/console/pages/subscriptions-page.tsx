"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, ExternalLink } from "lucide-react";
import { PLAN_LABELS, type ConsoleStudio } from "@/features/console/model";
import { money, relative } from "@/lib/console/format";
import { billingMomentText, downloadCsv, planLabel, stripeSubscriptionUrl, studioHref, subscriptionBadge, toCsv } from "@/lib/console/studio-display";
import { BillingDialogs, useBillingDialogs } from "../billing-dialogs";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { ChipSelect, FilterBar, SearchInput, matches } from "../filters";
import { ActionMenu } from "../menu";
import { Button, Empty, NameCell, PageHead, Pill, Stat, StatStrip, Tabs } from "../ui";
import { discountText } from "./studio-record";

/**
 * Subscriptions (docs/console.md, "Billing"): every studio's plan and billing
 * state in one table, with the subscription actions on each row.
 */
type View = "active" | "trialing" | "past_due" | "cancelling" | "comped" | "incomplete" | "cancelled" | "all";

const VIEWS: Array<{ key: View; label: string; test: (studio: ConsoleStudio) => boolean }> = [
  { key: "active", label: "Paying", test: (studio) => studio.subscriptionStatus === "active" && !studio.comped },
  { key: "trialing", label: "Trialing", test: (studio) => studio.subscriptionStatus === "trialing" && !studio.comped },
  { key: "past_due", label: "Past due", test: (studio) => studio.subscriptionStatus === "past_due" || studio.subscriptionStatus === "unpaid" || studio.subscriptionStatus === "paused" },
  { key: "cancelling", label: "Cancelling", test: (studio) => studio.cancelAtPeriodEnd },
  { key: "comped", label: "Comped", test: (studio) => studio.comped },
  { key: "incomplete", label: "No card yet", test: (studio) => studio.subscriptionStatus === "incomplete" && !studio.comped },
  { key: "cancelled", label: "Cancelled", test: (studio) => studio.subscriptionStatus === "cancelled" },
  { key: "all", label: "All", test: () => true },
];

export function SubscriptionsPage() {
  const { studios } = useConsole();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = (VIEWS.some((item) => item.key === params.get("view")) ? params.get("view") : "all") as View;
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const billing = useBillingDialogs();
  const all = studios.rows;
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((item) => [item.key, (all ?? []).filter(item.test).length])), [all]);
  const rows = useMemo(
    () => (all ? all.filter((studio) => VIEWS.find((item) => item.key === view)!.test(studio) && (!plan || studio.plan === plan) && matches(search, studio.name, studio.ownerEmail, studio.stripeCustomerId, studio.discount?.code)) : null),
    [all, view, plan, search],
  );
  const stats = useMemo(() => {
    const list = all ?? [];
    const mrr = list.reduce((sum, studio) => sum + studio.mrrCents, 0);
    const pipeline = list.filter((studio) => studio.subscriptionStatus === "trialing" && !studio.comped).reduce((sum, studio) => sum + studio.potentialMrrCents, 0);
    const atRisk = list.filter((studio) => studio.subscriptionStatus === "past_due" || studio.subscriptionStatus === "unpaid" || studio.subscriptionStatus === "paused").reduce((sum, studio) => sum + studio.potentialMrrCents, 0);
    const paying = list.filter((studio) => studio.mrrCents > 0).length;
    return { mrr, arr: mrr * 12, pipeline, atRisk, paying, arpa: paying ? Math.round(mrr / paying) : 0 };
  }, [all]);
  const setView = (next: View) => {
    const query = new URLSearchParams(params.toString());
    if (next === "all") query.delete("view");
    else query.set("view", next);
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  const columns = useMemo<ColumnDef<ConsoleStudio, unknown>[]>(
    () => [
      { id: "studio", header: "Studio", accessorFn: (studio) => studio.name.toLowerCase(), meta: { width: 220, flex: true }, cell: ({ row }) => <NameCell name={row.original.name} sub={row.original.ownerEmail} /> },
      { id: "plan", header: "Plan", accessorFn: (studio) => `${studio.plan}${studio.cadence}`, meta: { width: 128 }, cell: ({ row }) => planLabel(row.original.plan, row.original.cadence) },
      {
        id: "status",
        header: "Status",
        accessorFn: (studio) => studio.subscriptionStatus ?? "",
        meta: { width: 118 },
        cell: ({ row }) => {
          const badge = subscriptionBadge(row.original.subscriptionStatus, row.original.comped);
          return <Pill tone={badge.tone}>{badge.label}</Pill>;
        },
      },
      { id: "mrr", header: "MRR", accessorFn: (studio) => studio.mrrCents, meta: { width: 90, align: "right" }, cell: ({ row }) => (row.original.mrrCents ? money(row.original.mrrCents, { cents: true }) : <span className="cx-dim">—</span>) },
      {
        id: "discount",
        header: "Discount",
        accessorFn: (studio) => studio.discount?.code ?? (studio.discount ? "x" : ""),
        meta: { width: 200, priority: 3 },
        cell: ({ row }) =>
          row.original.discount ? (
            <span className="cx-inline">
              {row.original.discount.code ? <span className="cx-tag" data-tone="code">{row.original.discount.code}</span> : null}
              <span className="cx-sub">{discountText(row.original)}</span>
            </span>
          ) : (
            <span className="cx-dim">—</span>
          ),
      },
      {
        id: "next",
        header: "Next",
        accessorFn: (studio) => studio.billingMoment?.at ?? "9999",
        meta: { width: 140 },
        cell: ({ row }) => {
          const moment = billingMomentText(row.original.billingMoment);
          return <span className={moment.urgent ? "cx-strong" : undefined}>{moment.text}</span>;
        },
      },
      {
        id: "failed",
        header: "Payment",
        accessorFn: (studio) => studio.lastPaymentFailedAt ?? "",
        meta: { width: 120, priority: 2 },
        cell: ({ row }) => (row.original.lastPaymentFailedAt ? <Pill tone="bad">Failed {relative(row.original.lastPaymentFailedAt)}</Pill> : <span className="cx-dim">—</span>),
      },
      {
        id: "stripe",
        header: "Stripe",
        enableSorting: false,
        meta: { width: 64, priority: 4 },
        cell: ({ row }) =>
          row.original.stripeSubscriptionId ? (
            <a aria-label={`Open ${row.original.name} in Stripe`} className="cx-link" href={stripeSubscriptionUrl(row.original.stripeSubscriptionId)!} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
              <ExternalLink size={13} />
            </a>
          ) : (
            <span className="cx-dim">—</span>
          ),
      },
      {
        id: "menu",
        header: "",
        enableSorting: false,
        meta: { width: 44 },
        cell: ({ row }) => <ActionMenu iconOnly items={[{ label: "Open studio", onSelect: () => router.push(studioHref(row.original.tenantId, "billing")) }, ...billing.menuItems(row.original)]} label={`Billing actions for ${row.original.name}`} />,
      },
    ],
    [billing.menuItems, router], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <>
      <Topbar crumbs={[{ label: "Billing" }, { label: "Subscriptions" }]}>
        <Button
          disabled={!rows?.length}
          onClick={() =>
            rows &&
            downloadCsv(
              `studiocue-subscriptions-${new Date().toISOString().slice(0, 10)}.csv`,
              toCsv(
                ["Studio", "Plan", "Cadence", "Status", "Comped", "MRR", "Discount", "Trial ends", "Period end", "Cancels", "Stripe customer", "Stripe subscription"],
                rows.map((studio) => [
                  studio.name,
                  studio.plan ? (PLAN_LABELS[studio.plan] ?? studio.plan) : "",
                  studio.cadence,
                  studio.subscriptionStatus,
                  studio.comped ? "yes" : "",
                  (studio.mrrCents / 100).toFixed(2),
                  studio.discount ? `${studio.discount.code ?? ""} ${discountText(studio)}`.trim() : "",
                  studio.trialEndsAt,
                  studio.currentPeriodEnd,
                  studio.cancelAtPeriodEnd ? "yes" : "",
                  studio.stripeCustomerId,
                  studio.stripeSubscriptionId,
                ]),
              ),
            )
          }
        >
          <Download size={13} /> Export CSV
        </Button>
      </Topbar>
      <div className="cx-content">
        <PageHead count={all?.length ?? null} title="Subscriptions">
          <StatStrip>
            <Stat label="MRR" value={money(stats.mrr)} />
            <Stat label="ARR" value={money(stats.arr)} />
            <Stat label="Paying" value={stats.paying} />
            <Stat label="Avg per paying" value={money(stats.arpa)} />
            <Stat label="Trial pipeline" value={money(stats.pipeline)} />
            <Stat label="Past due MRR" tone={stats.atRisk ? "bad" : undefined} value={money(stats.atRisk)} />
          </StatStrip>
        </PageHead>
        <Tabs label="Subscription views" onChange={setView} tabs={VIEWS.map((item) => ({ key: item.key, label: item.label, count: all ? counts[item.key] : null }))} value={view} />
        <FilterBar>
          <SearchInput id="subscription-search" onChange={setSearch} placeholder="Filter by studio, email, customer or code" value={search} />
          <ChipSelect label="Plan" onChange={setPlan} options={Object.entries(PLAN_LABELS).map(([value, label]) => ({ value, label }))} value={plan} />
        </FilterBar>
        <DataTable
          columns={columns}
          empty={<Empty title="No subscriptions in this view" />}
          getRowId={(studio) => studio.tenantId}
          initialSort={[{ id: "mrr", desc: true }]}
          label="Subscriptions"
          mobile={(studio) => {
            const badge = subscriptionBadge(studio.subscriptionStatus, studio.comped);
            return { title: studio.name, end: <Pill tone={badge.tone}>{badge.label}</Pill>, meta: `${planLabel(studio.plan, studio.cadence)} · ${studio.mrrCents ? money(studio.mrrCents) : "no MRR"} · ${billingMomentText(studio.billingMoment).text}` };
          }}
          onRowClick={(studio) => router.push(studioHref(studio.tenantId, "billing"))}
          rows={rows}
        />
      </div>
      <BillingDialogs state={billing} />
    </>
  );
}
