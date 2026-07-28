"use client";

import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function LiveReports() {
  const projectsState = useTenantDocuments("projects");
  const leadsState = useTenantDocuments("leads");
  const invoicesState = useTenantDocuments("invoiceReferences");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [projectType, setProjectType] = useState("all");
  const projects = useMemo(
    () =>
      (projectsState.records ?? []).filter((project) => {
        const date = String(project.eventDate ?? "");
        return (
          (!dateFrom || date >= dateFrom) &&
          (!dateTo || date <= dateTo) &&
          (projectType === "all" ||
            String(project.eventType).toLowerCase() === projectType)
        );
      }),
    [dateFrom, dateTo, projectType, projectsState.records],
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const invoices = (invoicesState.records ?? []).filter((invoice) =>
    projectIds.has(String(invoice.projectId)),
  );
  const bookedValue = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.amountCents ?? 0),
    0,
  );
  const outstanding = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.balanceCents ?? 0),
    0,
  );
  const collected = bookedValue - outstanding;
  const readinessAverage = projects.length
    ? Math.round(
        projects.reduce(
          (sum, project) => sum + Number(project.readinessScore ?? 0),
          0,
        ) / projects.length,
      )
    : 0;
  const leadSources = Object.entries(
    (leadsState.records ?? []).reduce<Record<string, number>>((counts, lead) => {
      const key = String(lead.referralSource ?? "Unknown");
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const projectTypes = Object.entries(
    projects.reduce<Record<string, number>>((counts, project) => {
      const key = String(project.eventType ?? "Other");
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  );
  const maxSource = Math.max(1, ...leadSources.map(([, count]) => count));

  function exportCsv() {
    const header = [
      "Project ID",
      "Project",
      "Event type",
      "Event date",
      "State",
      "Readiness",
      "Next action",
    ];
    const rows = projects.map((project) => [
      project.id,
      project.name,
      project.eventType,
      project.eventDate,
      project.state,
      project.readinessScore,
      project.nextAction,
    ]);
    const content = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `studiocue-project-report-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const loading =
    projectsState.loading || leadsState.loading || invoicesState.loading;
  const error =
    projectsState.error || leadsState.error || invoicesState.error;
  return (
    <div className="post-event-page report-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Operational intelligence</p>
          <h1>Reports</h1>
          <p>Calculated from current tenant records and provider-synced financial references.</p>
        </div>
        <div className="report-actions">
          <button className="button" type="button" onClick={() => window.print()}>
            <Printer /> Print
          </button>
          <button className="button button-dark" type="button" onClick={exportCsv}>
            <Download /> Export CSV
          </button>
        </div>
      </header>
      <div className="report-filters">
        <label>
          From
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label>
          Project type
          <select value={projectType} onChange={(event) => setProjectType(event.target.value)}>
            <option value="all">All types</option>
            <option value="wedding">Wedding</option>
            <option value="corporate">Corporate</option>
            <option value="sports">Sports</option>
          </select>
        </label>
      </div>
      {error ? <p className="form-notice">{error}</p> : null}
      <section className="report-metrics">
        <article className="panel"><small>Projects</small><strong>{loading ? "—" : projects.length}</strong><span>Filtered event records</span></article>
        <article className="panel"><small>Average readiness</small><strong>{loading ? "—" : `${readinessAverage}%`}</strong><span>Deterministic project scores</span></article>
        <article className="panel"><small>Booked value</small><strong>{loading ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(bookedValue / 100)}</strong><span>Synced invoice references</span></article>
        <article className="panel"><small>Outstanding</small><strong>{loading ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(outstanding / 100)}</strong><span>Collected {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(collected / 100)}</span></article>
      </section>
      <div className="report-layout">
        <section className="panel">
          <div className="panel-heading"><div><h2>Lead sources</h2><p>Current intake attribution</p></div></div>
          <div className="report-bars">
            {leadSources.map(([source, count]) => (
              <article key={source}>
                <span><strong>{source}</strong><small>{count} leads</small></span>
                <i><b style={{ width: `${(count / maxSource) * 100}%` }} /></i>
              </article>
            ))}
            {!leadSources.length ? <p className="form-notice">No lead-source data in this tenant yet.</p> : null}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><h2>Projects by type</h2><p>Filtered portfolio mix</p></div></div>
          <div className="report-bars">
            {projectTypes.map(([type, count]) => (
              <article key={type}>
                <span><strong>{type}</strong><small>{count} projects</small></span>
                <i><b style={{ width: `${projects.length ? (count / projects.length) * 100 : 0}%` }} /></i>
              </article>
            ))}
          </div>
        </section>
      </div>
      <aside className="panel report-source-note">
        <h2>Financial source boundary</h2>
        <p>Revenue figures use StudioCue&apos;s latest QuickBooks invoice references and can lag the accounting system. QuickBooks remains authoritative.</p>
      </aside>
    </div>
  );
}
