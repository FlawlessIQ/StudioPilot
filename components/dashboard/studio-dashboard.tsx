"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  FolderKanban,
  MailCheck,
  Plus,
  ReceiptText,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { LiveUpcomingRows, useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";

const activeStates = new Set([
  "CONSULTATION",
  "PROPOSAL",
  "CONTRACT_PENDING",
  "RETAINER_PENDING",
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
]);

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function DashboardSummary() {
  const workspace = useWorkspace();
  const { records, error, loading } = useTenantDocuments("projects");
  const current = new Date();
  const active = (records ?? []).filter((project) =>
    activeStates.has(String(project.state)),
  );
  const eventsThisMonth = active.filter((project) => {
    const date = new Date(`${String(project.eventDate)}T12:00:00`);
    return (
      date.getFullYear() === current.getFullYear() &&
      date.getMonth() === current.getMonth()
    );
  }).length;
  const ready = active.filter(
    (project) =>
      project.state === "READY" || Number(project.readinessScore) === 100,
  ).length;
  const atRisk = active.filter(
    (project) => Number(project.readinessScore ?? 0) < 100,
  );
  const pipeline = [
    ["Consultations", "CONSULTATION"],
    ["Proposals", "PROPOSAL"],
    ["Contracts", "CONTRACT_PENDING"],
    ["Retainers", "RETAINER_PENDING"],
    ["Booked", "BOOKED"],
  ].map(([label, state]) => ({
    label,
    value: active.filter((project) => project.state === state).length,
  }));
  const maxPipeline = Math.max(1, ...pipeline.map((item) => item.value));
  const greetingName =
    workspace.userName === workspace.tenantName
      ? ""
      : `, ${firstName(workspace.userName)}`;

  return (
    <>
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">
            {current.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1>Good morning{greetingName}.</h1>
          <p>
            {loading
              ? "Loading your operational priorities…"
              : error
                ? "Studio data is temporarily unavailable."
                : active.length
                  ? "Here’s what needs your attention today."
                  : "Let’s set up the essentials for your first project."}
          </p>
        </div>
        <Link className="button button-dark" href={active.length ? "/studio/projects" : "/studio/projects/new"}>
          <Plus size={16} /> {active.length ? "View projects" : "Create first project"}
        </Link>
      </div>

      <SetupChecklist />

      {workspace.role !== "staff_photographer" ? (
        <DashboardPriorityStrip />
      ) : null}

      {["studio_owner", "studio_admin"].includes(workspace.role ?? "") ? (
        <OwnerAutomationSignal />
      ) : null}

      <section className="metric-grid" aria-label="Studio overview">
        <article className="metric-card">
          <span className="metric-label">Events this month</span>
          <strong>{loading ? "—" : eventsThisMonth}</strong>
          <span className="metric-note">From active project dates</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Projects ready</span>
          <strong>
            {loading ? "—" : ready} <small>/ {loading ? "—" : active.length}</small>
          </strong>
          <span className="metric-note">Required event checks completed</span>
        </article>
        <article className="metric-card metric-alert">
          <span className="metric-label">Projects needing action</span>
          <strong>{loading ? "—" : atRisk.length}</strong>
          <span className="metric-note warning">
            <CircleAlert size={14} /> Below 100% readiness
          </span>
        </article>
        <article className="metric-card">
          <span className="metric-label">Active projects</span>
          <strong>{loading ? "—" : active.length}</strong>
          <span className="metric-note">Cancelled and archived excluded</span>
        </article>
      </section>

      <div className="dashboard-grid">
        <section className="panel today-panel">
          <div className="panel-heading">
            <div>
              <h2>Next actions</h2>
              <p>Highest-priority project guidance</p>
            </div>
            <Link href="/studio/tasks">
              Open tasks <ArrowRight size={14} />
            </Link>
          </div>
          <div className="today-list">
            {atRisk
              .sort((a, b) =>
                String(a.eventDate).localeCompare(String(b.eventDate)),
              )
              .slice(0, 4)
              .map((project) => (
                <Link
                  className="today-row"
                  href={`/studio/projects/${project.id}`}
                  key={project.id}
                >
                  <span className="today-icon icon-amber">
                    <CalendarDays size={18} />
                  </span>
                  <div>
                    <small>{String(project.name)}</small>
                    <strong>
                      {String(project.nextAction ?? "Review project readiness")}
                    </strong>
                  </div>
                  <time>{String(project.eventDate)}</time>
                  <ArrowRight size={16} />
                </Link>
              ))}
            {!loading && !atRisk.length && active.length ? (
              <div className="live-record-state">
                <ShieldCheck size={18} />
                <span>
                  <strong>No active readiness blockers</strong>
                  <small>New required actions will appear here.</small>
                </span>
              </div>
            ) : null}
            {!loading && !active.length ? (
              <div className="dashboard-empty-action">
                <FolderKanban size={20} />
                <span>
                  <strong>Your first project starts here</strong>
                  <small>Add a client and event date, then StudioCue will guide the next steps.</small>
                </span>
                <Link href="/studio/projects/new">Create project <ArrowRight size={14} /></Link>
              </div>
            ) : null}
          </div>
        </section>
        <section className="panel risk-panel">
          <div className="panel-heading">
            <div>
              <h2>Pipeline</h2>
              <p>Current projects by booking stage</p>
            </div>
            <StatusBadge tone="info">Live data</StatusBadge>
          </div>
          <div className="pipeline-bars">
            {pipeline.map((stage) => (
              <div className="pipeline-row" key={stage.label}>
                <span>{stage.label}</span>
                <div>
                  <i
                    className="bar-green"
                    style={{ width: `${(stage.value / maxPipeline) * 100}%` }}
                  />
                </div>
                <strong>{loading ? "—" : stage.value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel projects-panel">
        <div className="panel-heading">
          <div>
            <h2>Upcoming projects</h2>
            <p>Readiness across the next active events</p>
          </div>
          <StatusBadge tone="info" dot>Live</StatusBadge>
        </div>
        <div className="project-table" role="table" aria-label="Upcoming projects">
          <div className="project-table-head" role="row">
            <span role="columnheader">Project</span>
            <span role="columnheader">Date</span>
            <span role="columnheader">State</span>
            <span role="columnheader">Readiness</span>
            <span role="columnheader">Main blocker</span>
          </div>
          <LiveUpcomingRows />
        </div>
      </section>
    </>
  );
}

function DashboardPriorityStrip() {
  const workspace = useWorkspace();
  const tasksState = useTenantDocuments("tasks");
  const consultationsState = useTenantDocuments("consultations");
  const questionnaireState = useTenantDocuments("questionnaireResponses");
  const projectsState = useTenantDocuments("projects");
  const today = new Date().toISOString().slice(0, 10);
  const dueTasks = (tasksState.records ?? []).filter(
    (task) =>
      !["complete", "completed", "cancelled"].includes(String(task.status)) &&
      String(task.dueDate ?? "").slice(0, 10) <= today,
  );
  const projectsNeedingAction = (projectsState.records ?? []).filter(
    (project) =>
      activeStates.has(String(project.state)) &&
      Number(project.readinessScore ?? 0) < 100,
  );
  const todayConsultations = (consultationsState.records ?? []).filter(
    (consultation) => String(consultation.startsAt ?? "").slice(0, 10) === today,
  );
  const submittedQuestionnaires = (questionnaireState.records ?? []).filter(
    (response) => response.status === "submitted" && !response.reviewedAt,
  );
  return (
    <section
      className="dashboard-priority-strip"
      aria-label="Today’s operational signals"
    >
      <Link href="/studio/tasks">
        <Clock3 />
        <span><small>Tasks due or overdue</small><strong>{dueTasks.length}</strong></span>
        <ArrowRight />
      </Link>
      {["studio_owner", "studio_admin"].includes(workspace.role ?? "") ? (
        <FinancialPrioritySignal />
      ) : (
        <Link href="/studio/projects">
          <CircleAlert />
          <span><small>Projects needing action</small><strong>{projectsNeedingAction.length}</strong></span>
          <ArrowRight />
        </Link>
      )}
      <Link href="/studio/calendar">
        <CalendarDays />
        <span><small>Consultations today</small><strong>{todayConsultations.length}</strong></span>
        <ArrowRight />
      </Link>
      <Link href="/studio/questionnaires">
        <MailCheck />
        <span><small>Client details to review</small><strong>{submittedQuestionnaires.length}</strong></span>
        <ArrowRight />
      </Link>
    </section>
  );
}

function FinancialPrioritySignal() {
  const invoicesState = useTenantDocuments("invoiceReferences");
  const today = new Date().toISOString().slice(0, 10);
  const overdueInvoices = (invoicesState.records ?? []).filter(
    (invoice) =>
      Number(invoice.balanceCents ?? 0) > 0 &&
      String(invoice.dueDate ?? "") < today &&
      !["voided", "refunded"].includes(String(invoice.status)),
  );
  return (
    <Link href="/studio/invoices">
      <ReceiptText />
      <span><small>Overdue balances</small><strong>{overdueInvoices.length}</strong></span>
      <ArrowRight />
    </Link>
  );
}

function OwnerAutomationSignal() {
  const runs = useTenantDocuments("automationRuns");
  const approvals = useTenantDocuments("automationApprovals");
  const integrations = useTenantDocuments("integrationConnections");
  const failures = (runs.records ?? []).filter((run) =>
    ["failed", "dead_letter"].includes(String(run.status)),
  );
  const pendingApprovals = (approvals.records ?? []).filter(
    (approval) => approval.status === "pending",
  );
  const integrationIssues = (integrations.records ?? []).filter(
    (connection) =>
      connection.status === "error" || Boolean(connection.lastError),
  );
  if (!failures.length && !pendingApprovals.length && !integrationIssues.length)
    return null;
  return (
    <section className="dashboard-automation-alert">
      <Workflow />
      <span>
        <strong>Automation operations need review</strong>
        <small>
          {failures.length} failed runs · {pendingApprovals.length} approvals ·{" "}
          {integrationIssues.length} integration issues
        </small>
      </span>
      <Link href="/studio/automations">
        Review operations <ArrowRight size={14} />
      </Link>
    </section>
  );
}

export function StudioDashboard() {
  return (
    <AppShell>
      <DashboardSummary />
    </AppShell>
  );
}
