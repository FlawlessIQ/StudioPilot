"use client";

import { isSalesConsultation } from "@/features/consultations/purpose";
import { useMemo, useState } from "react";
import { todayLocalIso } from "@/lib/format/event-date";
import Link from "next/link";
import {
  ArrowRight,
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
  TrendingDown,
  WalletCards,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { actionsPerWedding } from "@/features/reporting/actions-per-wedding";
import { workflowScorecard } from "@/features/operations/workflow-scorecard";
import { formatCents } from "@/lib/format/money";
import { analyseFunnel, jobFunnelStages } from "@/features/operations/funnel";
import { JOB_KIND_LABELS, JOB_KINDS, jobKindOf } from "@/features/job-kinds/job-kinds";
import { bookedStates } from "@/features/inquiries/stages";
import { inquiryInsights, replyTimeLabel } from "@/features/reporting/inquiry-insights";
import { InfoHint } from "@/components/ui/info-hint";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function LiveReports() {
  const projectsState = useTenantDocuments("projects");
  const leadsState = useTenantDocuments("leads");
  const conversationsState = useTenantDocuments("conversations");
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
          (projectType === "all" || jobKindOf(project) === projectType)
        );
      }),
    [dateFrom, dateTo, projectType, projectsState.records],
  );
  const projectIds = new Set(projects.map((project) => project.id));
  const invoices = (invoicesState.records ?? []).filter((invoice) =>
    projectIds.has(String(invoice.projectId)),
  );
  // Named for what it is. This is the sum of invoice amounts; Today's
  // "Booked" is the value of signed work from the package snapshots. Both
  // are useful and they are not the same number — calling both "Booked
  // value" put $37,485 on this page and $37,400 on the home page.
  const invoicedValue = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.amountCents ?? 0),
    0,
  );
  const outstanding = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.balanceCents ?? 0),
    0,
  );
  const collected = invoicedValue - outstanding;
  // Averaging readiness across every job counts a delivered wedding and an
  // unbooked inquiry as 0% ready, which drags the number to something that
  // describes nothing. Readiness is only a live question between booking
  // and the event, so only those jobs are averaged.
  const readinessTracked = projects.filter((project) =>
    ["BOOKED", "PLANNING", "READY"].includes(String(project.state)),
  );
  const readinessAverage = readinessTracked.length
    ? Math.round(
        readinessTracked.reduce(
          (sum, project) => sum + Number(project.readinessScore ?? 0),
          0,
        ) / readinessTracked.length,
      )
    : 0;
  // Where inquiries come from, how many book, how fast the studio answers
  // and why the rest closed — for inquiries that arrived in the filtered range.
  const inquiries = inquiryInsights({
    leads: leadsState.records ?? [],
    projects: projectsState.records ?? [],
    conversations: conversationsState.records ?? [],
    from: dateFrom || null,
    to: dateTo || null,
  });
  const leadSources = inquiries.sources.map((line) => [line.source, line.inquiries, line.booked] as const);
  // Weddings the studio has won. Every inquiry is a job from the moment it
  // arrives, so counting all jobs counted every couple who ever asked.
  const bookedProjects = projects.filter((project) => bookedStates.has(String(project.state)));
  // By kind of work (job-kinds.ts): "Wedding" and "wedding" were two bars,
  // and a studio's "Cheer" and "Sports" are one.
  const projectTypes = Object.entries(
    bookedProjects.reduce<Record<string, number>>((counts, project) => {
      const key = JOB_KIND_LABELS[jobKindOf(project)];
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {}),
  ).sort(([, left], [, right]) => right - left);
  const maxSource = Math.max(1, ...leadSources.map(([, count]) => count));
  const firstReplyHint =
    inquiries.replied === 0
      ? "Once you've replied to an inquiry"
      : `${inquiries.repliedWithinHour} of ${inquiries.replied} answered within the hour`;
  const scoped = (records: typeof projectsState.records) =>
    (records ?? []).filter((record) => {
      const linkedProject = String(record.projectId ?? "");
      return !linkedProject || projectIds.has(linkedProject);
    });
  // The funnel counts sales calls, not the final details call (features/consultations/purpose.ts).
  const consultations = scoped(consultationsState.records).filter((record) => isSalesConsultation(record));
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
  // Jobs that got at least this far, so the funnel only ever narrows
  // (features/operations/funnel.ts).
  const funnel = analyseFunnel(
    jobFunnelStages({ projects, consultations, proposals, contracts }),
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
    anchor.download = `studiocue-project-report-${todayLocalIso()}.csv`;
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
          <p className="eyebrow">How the studio is doing</p>
          <h1>Insights</h1>
          <p>Understand the health of your pipeline, projects, and collections without losing sight of where each number came from.</p>
        </div>
        {/* "Release evidence" moved to the foot of the page, beside the audit
            log: it is about how StudioCue ships, not how the studio is doing,
            and it was the widest button in the studio's own header. */}
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
            <strong>
              Report range
              <InfoHint label="Report range">
                Filters jobs by their event date, and inquiries by the date they arrived.
              </InfoHint>
            </strong>
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
          Kind of job
          <select value={projectType} onChange={(event) => setProjectType(event.target.value)}>
            <option value="all">All kinds</option>
            {JOB_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {JOB_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? <p className="form-notice">{error}</p> : null}
      <section className="report-metrics">
        <article className="panel report-metric-card report-metric-projects">
          <span className="report-metric-icon"><BriefcaseBusiness /></span>
          <span className="report-metric-copy"><small>Booked jobs</small><strong>{loading ? "—" : bookedProjects.length}</strong><span>Booked, in the filtered range</span></span>
        </article>
        <article className="panel report-metric-card report-metric-readiness">
          <span className="report-metric-icon"><Gauge /></span>
          <span className="report-metric-copy"><small>Average readiness<InfoHint label="Average readiness">The average readiness score of jobs that are Booked, Planning or Ready. Delivered jobs and inquiries aren&apos;t counted.</InfoHint></small><strong>{loading ? "—" : `${readinessAverage}%`}</strong><span>{`Across ${readinessTracked.length} booked ${readinessTracked.length === 1 ? "job" : "jobs"}`}</span></span>
        </article>
        <article className="panel report-metric-card report-metric-booked">
          <span className="report-metric-icon"><CircleDollarSign /></span>
          <span className="report-metric-copy"><small>Invoiced<InfoHint label="Invoiced">The total of every invoice raised for jobs in this range. It isn&apos;t the same as Booked on Today.</InfoHint></small><strong>{loading ? "—" : formatCents(invoicedValue)}</strong><span>Across every invoice raised</span></span>
        </article>
        <article className="panel report-metric-card report-metric-outstanding">
          <span className="report-metric-icon"><WalletCards /></span>
          <span className="report-metric-copy"><small>Outstanding<InfoHint label="Outstanding">What&apos;s still unpaid on those invoices. Collected, beneath it, is what&apos;s been paid.</InfoHint></small><strong>{loading ? "—" : formatCents(outstanding)}</strong><span>Collected {formatCents(collected)}</span></span>
        </article>
      </section>
      <div className="report-layout">
        <section className="panel report-chart-card">
          <div className="panel-heading">
            <div>
              <h2>
                Where inquiries come from
                <InfoHint label="Where inquiries come from">
                  Each source&apos;s inquiries, and how many of them booked. Closed without booking counts the ones
                  that didn&apos;t.
                </InfoHint>
              </h2>
              <p>
                {inquiries.inquiries
                  ? `${inquiries.inquiries} ${inquiries.inquiries === 1 ? "inquiry" : "inquiries"} · ${inquiries.winRate ?? 0}% booked · first reply in ${replyTimeLabel(inquiries.medianFirstReplyHours)} (median) — ${firstReplyHint}`
                  : "Inquiries, and how many book, by where they came from"}
              </p>
            </div>
          </div>
          <div className="report-bars">
            {leadSources.map(([source, count, won]) => (
              <article key={source}>
                <span>
                  <strong>{source}</strong>
                  <small>
                    {`${count} ${count === 1 ? "inquiry" : "inquiries"} · ${won} booked`}
                  </small>
                </span>
                <i><b style={{ width: `${(count / maxSource) * 100}%` }} /></i>
              </article>
            ))}
            {inquiries.closedReasons.length ? (
              <p className="report-closed-reasons">
                Closed without booking:{" "}
                {inquiries.closedReasons.map((line) => `${line.reason} ${line.count}`).join(" · ")}
              </p>
            ) : null}
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
          <div className="panel-heading"><div><h2>Booked jobs by type</h2><p>The mix of work you have won</p></div></div>
          <div className="report-bars">
            {projectTypes.map(([type, count]) => (
              <article key={type}>
                <span><strong>{type}</strong><small>{count} {count === 1 ? "job" : "jobs"}</small></span>
                <i><b style={{ width: `${bookedProjects.length ? (count / bookedProjects.length) * 100 : 0}%` }} /></i>
              </article>
            ))}
            {!projectTypes.length ? (
              <div className="report-empty-chart">
                <BriefcaseBusiness />
                <span>
                  <strong>Your portfolio mix will appear here</strong>
                  <small>Your first booked job starts the comparison by type.</small>
                </span>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      <section className="report-performance-section">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Studio outcomes</p>
            <h2>What StudioCue handled for you</h2>
            <p>Completed work, approvals, exceptions, and measured results from the selected period.</p>
          </div>
        </div>
        {(() => {
          const effort = actionsPerWedding({
            projects: projects as Array<Record<string, unknown> & { id: string }>,
            events: productEventsState.records ?? [],
          });
          return (
            <article className="panel report-effort">
              <span>
                <small>
                  Your actions per delivered wedding
                  <InfoHint label="Your actions per delivered wedding">
                    How many approvals, check-offs and sends a typical delivered wedding took from you. Lower means
                    StudioCue did more.
                  </InfoHint>
                </small>
                <strong>{loading ? "—" : effort.deliveredMedian ?? "Needs data"}</strong>
              </span>
              <p>
                {effort.deliveredMedian === null
                  ? "Once a wedding is delivered, this counts every approval, check-off and send it took from your side. Lower is better."
                  : `The typical wedding across ${effort.deliveredCount} delivered took this many approvals, check-offs and sends from your side. Lower is better.`}
                {effort.most ? (
                  <>
                    {" "}The most was{" "}
                    <a href={`/studio/projects/${encodeURIComponent(effort.most.projectId)}`}>{effort.most.name}</a>
                    {` (${effort.most.actions}).`}
                  </>
                ) : null}
              </p>
            </article>
          );
        })()}
        <div className="report-performance-grid">
          <article className="panel">
            <Bot />
            <span><small>Automations completed</small><strong>{loading ? "—" : terminalAutomations.filter((run) => run.status === "completed").length}</strong><p>Background jobs finished without needing a manual handoff</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Approvals completed</small><strong>{loading ? "—" : workflow.approvalLed.approvals}</strong><p>Prepared work reviewed and approved by your studio</p></span>
          </article>
          <article className="panel">
            <Info />
            <span><small>Exceptions needing review</small><strong>{loading ? "—" : workflow.approvalLed.exceptions}</strong><p>Cases StudioCue surfaced instead of guessing or sending automatically</p></span>
          </article>
          <article className="panel">
            <Bot />
            <span><small>Automation reliability</small><strong>{loading ? "—" : terminalAutomations.length ? `${automationReliability}%` : "Needs data"}</strong><p>{terminalAutomations.length} completed or final-status runs measured</p></span>
          </article>
        </div>
        <div className="report-performance-grid">
          <article className="panel">
            <ClockArrowUp />
            <span><small>Verified time reclaimed</small><strong>{loading ? "—" : workflow.quality.verifiedMinutesSaved ? `${workflow.quality.verifiedMinutesSaved}m` : "Needs data"}</strong><p>Measured from workflow timestamps and observed handling time</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Proposal acceptance</small><strong>{loading ? "—" : proposalsSent.length ? `${proposalAcceptance}%` : "Needs data"}</strong><p>{proposalsSent.length} delivered proposals measured</p></span>
          </article>
          <article className="panel">
            <CheckCircle2 />
            <span><small>Crew acceptance</small><strong>{loading ? "—" : crewAssignments.length ? `${crewAcceptance}%` : "Needs data"}</strong><p>{crewAssignments.length} assignments tracked</p></span>
          </article>
          <article className="panel">
            <ClockArrowUp />
            <span><small>AI drafts edited</small><strong>{loading ? "—" : workflow.quality.aiEditRate === null ? "Needs data" : `${workflow.quality.aiEditRate}%`}</strong><p>{workflow.quality.aiDecisions} AI drafts reviewed before approval</p></span>
          </article>
        </div>
        <div className="report-funnel panel">
          <div className="report-funnel-head">
            <div>
              <p className="eyebrow">Conversion</p>
              <h2>
                Where inquiries stop becoming bookings
                <InfoHint label="The funnel">
                  Jobs in this range that came in as an inquiry, and how many got at least as far as each
                  step. Imported bookings aren&apos;t counted — they never went through it.
                </InfoHint>
              </h2>
            </div>
            {funnel.biggestLeak ? (
              <p className="report-funnel-leak">
                <TrendingDown aria-hidden="true" size={15} />
                <span>
                  <strong>
                    {funnel.biggestLeak.lost} lost between{" "}
                    {funnel.biggestLeak.fromLabel.toLowerCase()} and{" "}
                    {funnel.biggestLeak.toLabel.toLowerCase()}
                  </strong>
                  <small>
                    Only {funnel.biggestLeak.conversion}% carried through — your
                    largest leak.
                  </small>
                </span>
              </p>
            ) : null}
          </div>
          <ol className="report-funnel-steps">
            {funnel.steps.map((step) => (
              <li key={step.label}>
                <span className="report-funnel-label">
                  <small>{step.label}</small>
                  <strong>{loading ? "—" : step.value}</strong>
                </span>
                <span className="report-funnel-track">
                  <span
                    className={`report-funnel-fill${
                      step.lostFromPrevious > 0 ? " is-leaking" : ""
                    }`}
                    style={{ width: `${step.shareOfStart ?? 100}%` }}
                  />
                </span>
                <span className="report-funnel-rate">
                  {step.conversionFromPrevious === null ? (
                    <em>{step.exceedsPrevious ? "—" : "start"}</em>
                  ) : (
                    <>
                      {step.conversionFromPrevious}%
                      {step.lostFromPrevious > 0 ? (
                        <em>&minus;{step.lostFromPrevious}</em>
                      ) : null}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="report-estimate-note">
          Results appear only after real workflow activity is recorded; StudioCue does not invent time savings from record creation. Insurance certificate turnaround: {averageCoiTurnaround === null ? "not enough completed requests yet" : `${averageCoiTurnaround} days on average`}.
        </p>
      </section>
      <aside className="panel report-source-note">
        <Info />
        <span>
          <h2>QuickBooks remains your financial source of truth</h2>
          <p>StudioCue uses the latest synchronized invoice references for this operational view. Figures can briefly lag your accounting system.</p>
          {/* The audit log had no inbound link anywhere in the app. This page is
              about where each number came from, so it belongs here. */}
          <Link className="report-audit-link" href="/studio/audit">
            See the full audit log <ArrowRight aria-hidden="true" size={14} />
          </Link>
          <Link className="report-audit-link" href="/studio/reports/release-evidence">
            How StudioCue checks a release <ArrowRight aria-hidden="true" size={14} />
          </Link>
        </span>
      </aside>
    </div>
  );
}
