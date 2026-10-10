"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  filterLedger,
  ledgerCsv,
  ledgerRows,
  ledgerStateLabel,
  ledgerTotals,
  type LedgerFilter,
  type LedgerRow,
} from "@/features/billing/invoice-ledger";
import { resolveFile } from "@/lib/documents/resolve-file";
import { formatCentsExact } from "@/lib/format/money";
import { formatDueDate, todayLocalIso } from "@/lib/format/event-date";

const FILTERS: ReadonlyArray<{ key: LedgerFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "owed", label: "Owed" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Not sent" },
  { key: "paid", label: "Paid" },
];

/**
 * Every bill on every job, in one list: what's outstanding, what's late,
 * what hasn't gone out, and a CSV for the bookkeeper
 * (features/billing/invoice-ledger.ts; own invoicing, Phase 4). Each row
 * opens the job's own invoices, where it's sent, recorded or voided.
 */
export function InvoiceLedger({ projectId }: { projectId?: string }) {
  const workspace = useWorkspace();
  const { records: invoices, loading } = useTenantDocuments("invoiceReferences");
  const { records: projects } = useTenantDocuments("projects");
  const { records: contacts } = useTenantDocuments("contacts");
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [pdfLink, setPdfLink] = useState<{ id: string; url: string } | null>(null);
  const today = todayLocalIso();
  const rows = useMemo(
    () => ledgerRows({ invoices, projects, contacts, today, projectId: projectId ?? null }),
    [invoices, projects, contacts, today, projectId],
  );
  const totals = useMemo(() => ledgerTotals(rows), [rows]);
  const shown = useMemo(() => filterLedger(rows, filter), [rows, filter]);

  function downloadCsv() {
    const blob = new Blob([ledgerCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `invoices-${filter}-${today}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function openPdf(row: LedgerRow) {
    if (!row.pdfPath) return;
    setNotice(null);
    const tab = window.open("", "_blank");
    const result = await resolveFile({ kind: "storage", path: row.pdfPath, label: row.number }, workspace.tenantId ?? null);
    if (result.status !== "ready") {
      tab?.close();
      setNotice(result.message);
      return;
    }
    if (tab) {
      tab.opener = null;
      tab.location.href = result.url;
    } else {
      setPdfLink({ id: row.id, url: result.url });
    }
  }

  if (loading && !invoices) return <p className="panel">Loading your invoices…</p>;
  if (!rows.length) return null;

  return (
    <section aria-labelledby="invoice-ledger-title" className="invoice-ledger">
      <div className="invoice-ledger-totals">
        <div>
          <small>Outstanding</small>
          <strong>{formatCentsExact(totals.outstandingCents)}</strong>
        </div>
        <div className={totals.overdueCount ? "is-late" : undefined}>
          <small>Overdue</small>
          <strong>{formatCentsExact(totals.overdueCents)}</strong>
          {totals.overdueCount ? <span>{`${totals.overdueCount} ${totals.overdueCount === 1 ? "bill" : "bills"}`}</span> : null}
        </div>
        <div>
          <small>Not sent yet</small>
          <strong>{formatCentsExact(totals.draftCents)}</strong>
          {totals.draftCount ? <span>{`${totals.draftCount} ${totals.draftCount === 1 ? "invoice" : "invoices"}`}</span> : null}
        </div>
        <div>
          <small>Received</small>
          <strong>{formatCentsExact(totals.paidCents)}</strong>
        </div>
      </div>
      <div className="invoice-ledger-bar">
        <h2 id="invoice-ledger-title">Every bill</h2>
        <div className="invoice-ledger-filters" role="group" aria-label="Show">
          {FILTERS.map((option) => (
            <button
              aria-pressed={filter === option.key}
              className={filter === option.key ? "invoice-ledger-filter is-active" : "invoice-ledger-filter"}
              key={option.key}
              onClick={() => setFilter(option.key)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className="button button-light button-sm" disabled={!shown.length} onClick={downloadCsv} type="button">
          <Download size={14} /> Download CSV
        </button>
      </div>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
      {shown.length ? (
        <ul className="invoice-ledger-list">
          {shown.map((row) => (
            <li className={`invoice-ledger-row is-${row.state}`} key={row.id}>
              <Link className="invoice-ledger-main" href={`/studio/invoices?project=${encodeURIComponent(row.projectId)}`}>
                <strong>{row.number ? `${row.number} · ${row.jobName}` : row.jobName}</strong>
                <small>
                  {[row.kindLabel, row.sourceLabel, row.dueDate && row.state !== "paid" ? `due ${formatDueDate(row.dueDate)}` : null, row.state === "paid" && row.paidOn ? `paid ${formatDueDate(row.paidOn)}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </Link>
              <span className="invoice-ledger-money">
                <strong>{formatCentsExact(row.state === "paid" ? row.amountCents : row.balanceCents)}</strong>
                <span className={`invoice-ledger-state is-${row.state}`}>{ledgerStateLabel(row.state)}</span>
              </span>
              {row.pdfPath ? (
                pdfLink?.id === row.id ? (
                  <a className="invoice-ledger-pdf" href={pdfLink.url} rel="noreferrer" target="_blank">
                    <FileText size={14} /> Open
                  </a>
                ) : (
                  <button className="invoice-ledger-pdf" onClick={() => void openPdf(row)} type="button">
                    <FileText size={14} /> PDF
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="invoice-ledger-empty">Nothing here right now.</p>
      )}
    </section>
  );
}
