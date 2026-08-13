"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDollarSign,
  ClockArrowUp,
  Download,
  Gauge,
  Info,
  Printer,
  SlidersHorizontal,
  WalletCards,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { workflowScorecard } from "@/features/operations/workflow-scorecard";
import { implementationReadinessScorecard } from "@/features/operations/implementation-readiness";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function LiveReports() {
  const projectsState = useTenantDocuments("projects");
  const leadsState = useTenantDocuments("leads");
  const invoicesState = useTenantDocuments("invoiceReferences");
  const consultationsState = useTenantDocuments("consultations");
  const proposalsState = useTenantDocuments("proposals");
  const contractsState = useTenantDocuments("contracts");
  const crewState = useTenantDocuments("crewAssignments");
  const insuranceState = useTenantDocuments("insuranceRequests");
  const automationsState = useTenantDocuments("automationRuns");
  const productEventsState = useTenantDocuments("productEvents");
  const aiActionsState = useTenantDocuments("aiActions");
  const receiptsState = useTenantDocuments("actionReceipts");
  const providerJobsState = useTenantDocuments("providerJobs");
  const emailJobsState = useTenantDocuments("emailJobs");
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
  const scoped = (records: typeof projectsState.records) =>
    (records ?? []).filter((record) => {
      const linkedProject = String(record.projectId ?? "");
      return !linkedProject || projectIds.has(linkedProject);
    });
  const consultations = scoped(consultationsState.records);
  const proposals = scoped(proposalsState.records);
  const contracts = scoped(contractsState.records);
  const crewAssignments = scoped(crewState.records);
  const insurance = scoped(insuranceState.records);
  const automations = scoped(automationsState.records);
  const productEvents = scoped(productEventsState.records);
  const aiActions = scoped(aiActionsState.records);
  const receipts = scoped(receiptsState.records);
  const providerJobs = scoped(providerJobsState.records);
  const emailJobs = scoped(emailJobsState.records);
  const workflow = workflowScorecard({
    productEvents,
    aiActions,
    actionReceipts: receipts,
    automationRuns: automations,
    providerJobs,
    emailJobs,
  });
  const implementation = implementationReadinessScorecard();
  const terminalAutomationStatuses = new Set([
    "completed",
    "failed",
    "dead_letter",
  ]);
  const terminalAutomations = automations.filter((run) =>
    terminalAutomationStatuses.has(String(run.status)),
  );
  const automationReliability = terminalAutomations.length
    ? Math.round(
        (terminalAutomations.filter((run) => run.status === "completed").length /
          terminalAutomations.length) *
          100,
      )
    : 0;
  const proposalsSent = proposals.filter((item) =>
    ["sent", "viewed", "accepted", "declined", "expired"].includes(
      String(item.status),
    ),
  );
  const proposalAcceptance = proposalsSent.length
    ? Math.round(
        (proposalsSent.filter((item) => item.status === "accepted").length /
          proposalsSent.length) *
          100,
      )
    : 0;
  const acceptedCrew = crewAssignments.filter(
    (item) => item.status === "accepted" || item.status === "completed",
  ).length;
  const crewAcceptance = crewAssignments.length
    ? Math.round((acceptedCrew / crewAssignments.length) * 100)
    : 0;
  const coiTurnaroundDays = insurance
    .flatMap((item) => {
      if (!item.requestedAt || !item.approvedAt) return [];
      const duration =
        new Date(String(item.approvedAt)).valueOf() -
        new Date(String(item.requestedAt)).valueOf();
      return duration >= 0 ? [duration / 86_400_000] : [];
    });
  const averageCoiTurnaround = coiTurnaroundDays.length
    ? Math.round(
        coiTurnaroundDays.reduce((sum, value) => sum + value, 0) /
          coiTurnaroundDays.length,
      )
    : null;
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
    projectsState.loading ||
    leadsState.loading ||
    invoicesState.loading ||
    consultationsState.loading ||
    proposalsState.loading ||
    contractsState.loading ||
    crewState.loading ||
    insuranceState.loading ||
    automationsState.loading ||
    productEventsState.loading ||
    aiActionsState.loading ||
    receiptsState.loading ||
    providerJobsState.loading ||
    emailJobsState.loading;
  const error =
    projectsState.error || leadsState.error || invoicesState.error;
  return (
    <div className="post-event-page report-page">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Operational intelligence</p>
          <h1>Reports</h1>
          <p>Understand the health of your pipeline, projects, and collections without losing sight of where each number came from.</p>
        </div>
        <div className="report-actions">
          <button className="button button-light" type="button" onClick={() => window.print()}>
            <Printer /> Print
          </button>
          <button className="button button-dark" type="button" onClick={exportCsv}>
            <Download /> Export CSV
          </button>
        </div>
      </header>
      <div className="report-filters">
        <div className="report-filter-heading">
          <span className="report-filter-icon"><SlidersHorizontal /></span>
          <span>
            <strong>Report range</strong>
            <small>Focus every metric below</small>
          </span>
        </div>
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
        <article className="panel report-metric-card report-metric-projects">
          <span className="report-metric-icon"><BriefcaseBusiness /></span>
          <span className="report-metric-copy"><small>Projects</small><strong>{loading ? "—" : projects.length}</strong><span>Filtered event records</span></span>
        </article>
        <article className="panel report-metric-card report-metric-readiness">
          <span className="report-metric-icon"><Gauge /></span>
          <span className="report-metric-copy"><small>Average readiness</small><strong>{loading ? "—" : `${readinessAverage}%`}</strong><span>Deterministic project scores</span></span>
        </article>
        <article className="panel report-metric-card report-metric-booked">
          <span className="report-metric-icon"><CircleDollarSign /></span>
          <span className="report-metric-copy"><small>Booked value</small><strong>{loading ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(bookedValue / 100)}</strong><span>Synced invoice references</span></span>
        </article>
        <article className="panel report-metric-card report-metric-outstanding">
          <span className="report-metric-icon"><WalletCards /></span>
          <span className="report-metric-copy"><small>Outstanding</small><strong>{loading ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(outstanding / 100)}</strong><span>Collected {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(collected / 100)}</span></span>
        </article>
      </section>
      <div className="report-layout">
        <section className="panel report-chart-card">
          <div className="panel-heading"><div><h2>Lead sources</h2><p>Current intake attribution</p></div></div>
          <div className="report-bars">
            {leadSources.map(([source, count]) => (
              <article key={source}>
                <span><strong>{source}</strong><small>{count} leads</small></span>
                <i><b style={{ width: `${(count / maxSource) * 100}%` }} /></i>
              </article>
            ))}
            {!leadSources.length ? (
              <div className="report-empty-chart">
                <BarChart3 />
                <span>
                  <strong>Attribution starts with your next inquiry</strong>
                  <small>Lead sources will build here as inquiry forms are submitted.</small>
                </span>
              </div>
            ) : null}
          </div>
        </section>
        <section className="panel report-chart-card">
          <div className="panel-heading"><div><h2>Projects by type</h2><p>Filtered portfolio mix</p></div></div>
          <div className="report-bars">
            {projectTypes.map(([type, count]) => (
              <article key={type}>
                <span><strong>{type}</strong><small>{count} projects</small></span>
                <i><b style={{ width: `${projects.length ? (count / projects.length) * 100 : 0}%` }} /></i>
              </article>
            ))}
            {!projectTypes.length ? (
              <div className="report-empty-chart">
                <BriefcaseBusiness />
                <span>
                  <strong>Your portfolio mix will appear here</strong>
                  <small>Create a project to begin comparing work by project type.</small>
                </span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <section className="report-performance-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Workflow performance</p>
            <h2>Where StudioCue is reducing coordination work</h2>
            <p>Observed workflow events, provider outcomes, and verified handling-time evidence.</p>
          </div>
        </div>
        <div className="report-performance-grid workflow-score-grid">
          <article className="panel">
            <Gauge />
            <span><small>Validated capability coverage</small><strong>{loading ? "—" : `${implementation.coverage.score}%`}</strong><p>{implementation.coverage.operational} operational · {implementation.coverage.partial} partial · {implementation.coverage.total} total</p></span>
          </article>
          <article className="panel">
            <Bot />
            <span><small>Validated photographer automation</small><strong>{loading ? "—" : `${implementation.automation.score}%`}</strong><p>{implementation.automation.prepared} of {implementation.automation.eligible} repeatable steps are prepared or completed</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Validated approval-led experience</small><strong>{loading ? "—" : `${implementation.approvalLed.score}%`}</strong><p>{implementation.approvalLed.approvalOrExceptionTouches} approval/exception boundaries · {implementation.approvalLed.manualRoutineTouches} routine manual steps</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Acceptance slices</small><strong>{loading ? "—" : implementation.workflows.length}</strong><p>Each maps to a tested capability and concrete implementation evidence</p></span>
          </article>
        </div>
        <p className="report-estimate-note">
          Validated scores measure implemented workflow design and automated acceptance coverage. They exclude photography, curation, and other intentionally human creative work.
        </p>
        <div className="report-performance-grid">
          <article className="panel">
            <Bot />
            <span><small>Observed photographer automation</small><strong>{loading ? "—" : workflow.automation.score === null ? "Needs data" : `${workflow.automation.score}%`}</strong><p>{workflow.automation.observedSteps} completed repeatable workflow steps</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Observed approval-led experience</small><strong>{loading ? "—" : workflow.approvalLed.score === null ? "Needs data" : `${workflow.approvalLed.score}%`}</strong><p>{workflow.approvalLed.approvals} approvals · {workflow.approvalLed.exceptions} exceptions · {workflow.approvalLed.dataEntry + workflow.approvalLed.routineManual} routine touches</p></span>
          </article>
          <article className="panel">
            <ClockArrowUp />
            <span><small>Verified time reclaimed</small><strong>{loading ? "—" : `${workflow.quality.verifiedMinutesSaved}m`}</strong><p>Only timers, workflow timestamps, and observed pilot evidence count</p></span>
          </article>
          <article className="panel">
            <Bot />
            <span><small>Automation reliability</small><strong>{loading ? "—" : `${automationReliability}%`}</strong><p>{terminalAutomations.length} completed or terminal runs</p></span>
          </article>
        </div>
        <div className="report-performance-grid">
          <article className="panel">
            <CheckCircle2 />
            <span><small>Proposal acceptance</small><strong>{loading ? "—" : `${proposalAcceptance}%`}</strong><p>{proposalsSent.length} delivered proposals</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Crew acceptance</small><strong>{loading ? "—" : `${crewAcceptance}%`}</strong><p>{crewAssignments.length} assignments tracked</p></span>
          </article>
          <article className="panel">
            <ClockArrowUp />
            <span><small>AI edit rate</small><strong>{loading ? "—" : workflow.quality.aiEditRate === null ? "Needs data" : `${workflow.quality.aiEditRate}%`}</strong><p>{workflow.quality.aiDecisions} reviewed AI decisions</p></span>
          </article>
          <article className="panel">
            <Gauge />
            <span><small>Observed workflow coverage</small><strong>{loading ? "—" : `${workflow.coverage.score}%`}</strong><p>Canonical capability registry used by live outcome reporting</p></span>
          </article>
        </div>
        <div className="report-funnel panel">
          {[
            ["Inquiries", leadsState.records?.length ?? 0],
            ["Consultations", consultations.length],
            ["Proposals sent", proposalsSent.length],
            ["Contracts complete", contracts.filter((item) => item.status === "completed").length],
            ["Booked projects", projects.filter((item) => ["BOOKED", "PLANNING", "READY", "EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED", "CLOSED"].includes(String(item.state))).length],
          ].map(([label, value], index) => (
            <article key={String(label)}>
              <span>{index + 1}</span>
              <small>{String(label)}</small>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
        <p className="report-estimate-note">
          StudioCue no longer awards estimated minutes for creating records. Automation and approval-led percentages appear only after observed workflow events exist. COI turnaround: {averageCoiTurnaround === null ? "not enough completed requests yet" : `${averageCoiTurnaround} days on average`}.
        </p>
      </section>
      <aside className="panel report-source-note">
        <Info />
        <span>
          <h2>QuickBooks remains your financial source of truth</h2>
          <p>StudioCue uses the latest synchronized invoice references for this operational view. Figures can briefly lag your accounting system.</p>
        </span>
      </aside>
    </div>
  );
}
