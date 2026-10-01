"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { collection, limit, limitToLast, orderBy, query } from "firebase/firestore";
import type { ColumnDef } from "@tanstack/react-table";
import { ExternalLink } from "lucide-react";
import { humanize, money, shortDate } from "@/lib/console/format";
import { useLiveQuery } from "@/lib/console/live";
import { studioHref } from "@/lib/console/studio-display";
import { useNow } from "@/lib/console/use-now";
import { BarChart, LineChart } from "../charts";
import { useConsole } from "../console-context";
import { Topbar } from "../console-frame";
import { DataTable } from "../data-table";
import { Empty, PageHead, Panel, Pill, Stat, StatStrip } from "../ui";

/**
 * Revenue (docs/console.md): MRR over time from the rollup's daily totals,
 * money collected by month from Stripe's invoices, and how each month's
 * signups turned out. Every figure here is from StudioCue's own Stripe
 * products only.
 */
type Metric = { id: string; day: string; mrrCents: number; paying: number; trialing: number; pastDue: number; signups: number; trialPipelineCents?: number };
type Invoice = {
  id: string;
  tenantId: string;
  number?: string | null;
  status?: string | null;
  billingReason?: string | null;
  totalCents?: number;
  amountPaidCents?: number;
  amountDueCents?: number;
  discountCents?: number;
  createdAt: string;
  paidAt?: string | null;
  lastEvent?: string;
  hostedInvoiceUrl?: string | null;
};

const monthLabel = (key: string) => new Date(`${key}-01T12:00:00`).toLocaleDateString("en-GB", { month: "short" });

export function RevenuePage() {
  const router = useRouter();
  const { studios, studioById } = useConsole();
  const metrics = useLiveQuery<Metric>("revenue:metrics", (firestore) => query(collection(firestore, "consoleMetrics"), orderBy("day"), limitToLast(120)));
  const invoices = useLiveQuery<Invoice>("revenue:invoices", (firestore) => query(collection(firestore, "saasInvoices"), orderBy("createdAt", "desc"), limit(500)));

  const days = useMemo(() => [...(metrics.rows ?? [])].sort((a, b) => a.day.localeCompare(b.day)).slice(-90), [metrics.rows]);
  const months = useMemo(() => {
    const keys: string[] = [];
    const now = new Date();
    for (let offset = 11; offset >= 0; offset -= 1) keys.push(new Date(now.getFullYear(), now.getMonth() - offset, 1).toISOString().slice(0, 7));
    return keys;
  }, []);
  const collected = useMemo(() => {
    const totals = new Map<string, number>();
    for (const invoice of invoices.rows ?? []) {
      if (invoice.lastEvent !== "invoice.paid" && invoice.status !== "paid") continue;
      const key = (invoice.paidAt ?? invoice.createdAt).slice(0, 7);
      totals.set(key, (totals.get(key) ?? 0) + (invoice.amountPaidCents ?? 0));
    }
    return months.map((key) => ({ label: monthLabel(key), value: totals.get(key) ?? 0 }));
  }, [invoices.rows, months]);
  const cohorts = useMemo(
    () =>
      months.slice(-6).map((key) => {
        const signed = (studios.rows ?? []).filter((studio) => studio.createdAt?.startsWith(key));
        const paying = signed.filter((studio) => studio.mrrCents > 0 || (studio.subscriptionStatus === "active" && !studio.comped)).length;
        const trialing = signed.filter((studio) => studio.subscriptionStatus === "trialing").length;
        const lost = signed.filter((studio) => ["cancelled", "incomplete"].includes(studio.subscriptionStatus ?? "")).length;
        return { key, signed: signed.length, paying, trialing, lost };
      }),
    [studios.rows, months],
  );

  const all = studios.rows ?? [];
  const now = useNow();
  const mrr = all.reduce((sum, studio) => sum + studio.mrrCents, 0);
  const start = days.find((day) => day.day >= new Date(now - 30 * 86_400_000).toISOString().slice(0, 10));
  const change = start ? mrr - start.mrrCents : null;
  const failed = (invoices.rows ?? []).filter((invoice) => invoice.lastEvent === "invoice.payment_failed" && invoice.status !== "paid");
  const collectedThisMonth = collected.at(-1)?.value ?? 0;

  const columns: ColumnDef<Invoice, unknown>[] = [
    { id: "date", header: "Date", accessorFn: (invoice) => invoice.paidAt ?? invoice.createdAt, meta: { width: 100 }, cell: ({ row }) => shortDate(row.original.paidAt ?? row.original.createdAt) },
    { id: "studio", header: "Studio", accessorFn: (invoice) => studioById(invoice.tenantId)?.name ?? invoice.tenantId, meta: { width: 220, flex: true }, cell: ({ row }) => <span className="cx-strong">{studioById(row.original.tenantId)?.name ?? row.original.tenantId}</span> },
    { id: "reason", header: "For", accessorFn: (invoice) => invoice.billingReason ?? "", meta: { width: 150, priority: 3 }, cell: ({ row }) => humanize(row.original.billingReason ?? "") },
    {
      id: "status",
      header: "Status",
      accessorFn: (invoice) => invoice.status ?? "",
      meta: { width: 120 },
      cell: ({ row }) => {
        const failedNow = row.original.lastEvent === "invoice.payment_failed" && row.original.status !== "paid";
        return <Pill tone={row.original.status === "paid" ? "ok" : failedNow ? "bad" : "neutral"}>{failedNow ? "Payment failed" : humanize(row.original.status ?? "")}</Pill>;
      },
    },
    { id: "discount", header: "Discount", accessorFn: (invoice) => invoice.discountCents ?? 0, meta: { width: 96, align: "right", priority: 2 }, cell: ({ row }) => (row.original.discountCents ? `−${money(row.original.discountCents, { cents: true })}` : <span className="cx-dim">—</span>) },
    { id: "amount", header: "Amount", accessorFn: (invoice) => invoice.totalCents ?? 0, meta: { width: 100, align: "right" }, cell: ({ row }) => money(row.original.totalCents ?? 0, { cents: true }) },
    {
      id: "link",
      header: "",
      enableSorting: false,
      meta: { width: 44, priority: 4 },
      cell: ({ row }) =>
        row.original.hostedInvoiceUrl ? (
          <a aria-label="Open the invoice in Stripe" className="cx-link" href={row.original.hostedInvoiceUrl} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">
            <ExternalLink size={13} />
          </a>
        ) : null,
    },
  ];

  return (
    <>
      <Topbar crumbs={[{ label: "Billing" }, { label: "Revenue" }]} />
      <div className="cx-content">
        <PageHead title="Revenue">
          <StatStrip>
            <Stat label="MRR" value={money(mrr)} />
            <Stat label="ARR" value={money(mrr * 12)} />
            <Stat label="MRR change, 30d" tone={change === null ? undefined : change < 0 ? "bad" : change > 0 ? "ok" : undefined} value={change === null ? "—" : `${change >= 0 ? "+" : "−"}${money(Math.abs(change))}`} />
            <Stat label="Collected this month" value={money(collectedThisMonth)} />
            <Stat label="Failed payments" tone={failed.length ? "bad" : undefined} value={failed.length} />
          </StatStrip>
        </PageHead>
        <div className="cx-grid-2">
          <Panel title="MRR, last 90 days">
            {days.length >= 2 ? (
              <LineChart format={(value) => money(value)} label="Monthly recurring revenue by day" points={days.map((day) => ({ label: shortDate(`${day.day}T12:00:00Z`), value: day.mrrCents }))} />
            ) : (
              <Empty title="The trend starts today">The rollup records MRR once a day. Come back tomorrow for a line.</Empty>
            )}
          </Panel>
          <Panel title="Collected by month">
            {collected.some((point) => point.value) ? (
              <BarChart format={(value) => (value >= 100_000 ? `$${Math.round(value / 100_000)}k` : money(value))} label="Money collected by month" points={collected} />
            ) : (
              <Empty title="No paid invoices yet">Paid invoices are recorded from Stripe as they arrive, from this release on.</Empty>
            )}
          </Panel>
        </div>
        <Panel flush title="Signups by month, and where they are now">
          <div className="cx-table-wrap" style={{ border: 0, borderRadius: 0 }}>
            <table aria-label="Signup cohorts" className="cx-table">
              <thead>
                <tr>
                  <th className="cx-th">Month</th>
                  <th className="cx-th" data-align="right">Signed up</th>
                  <th className="cx-th" data-align="right">Paying now</th>
                  <th className="cx-th" data-align="right">Still trialing</th>
                  <th className="cx-th" data-align="right">Lost or no card</th>
                  <th className="cx-th" data-align="right">Converted</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.map((cohort) => (
                  <tr className="cx-row" key={cohort.key}>
                    <td className="cx-td">{new Date(`${cohort.key}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</td>
                    <td className="cx-td" data-align="right">{cohort.signed}</td>
                    <td className="cx-td" data-align="right">{cohort.paying}</td>
                    <td className="cx-td" data-align="right">{cohort.trialing}</td>
                    <td className="cx-td" data-align="right">{cohort.lost}</td>
                    <td className="cx-td" data-align="right">{cohort.signed ? `${Math.round((cohort.paying / cohort.signed) * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <DataTable
          columns={columns}
          empty={<Empty title="No invoices recorded yet">They appear here as Stripe sends them.</Empty>}
          getRowId={(invoice) => invoice.id}
          initialSort={[{ id: "date", desc: true }]}
          label="Invoices"
          mobile={(invoice) => ({ title: studioById(invoice.tenantId)?.name ?? invoice.tenantId, end: money(invoice.totalCents ?? 0, { cents: true }), meta: `${shortDate(invoice.paidAt ?? invoice.createdAt)} · ${humanize(invoice.status ?? "")}` })}
          onRowClick={(invoice) => router.push(studioHref(invoice.tenantId, "billing"))}
          rows={invoices.rows}
        />
      </div>
    </>
  );
}
