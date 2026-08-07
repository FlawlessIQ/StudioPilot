"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  CircleAlert,
  Clock3,
  FileText,
  FolderKanban,
  MailCheck,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRoundCheck,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { JourneyUpNext } from "@/components/dashboard/journey-up-next";
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
  const projects = records ?? [];
  const active = projects.filter((project) =>
    activeStates.has(String(project.state)),
  );
  const atRisk = active.filter(
    (project) => Number(project.readinessScore ?? 0) < 100,
  );
  const lifecycle = [
    {
      label: "Inquiries",
      detail: "Qualify & consult",
      states: ["LEAD", "CONSULTATION"],
      href: "/studio/leads",
      tone: "coral",
    },
    {
      label: "Booking",
      detail: "Proposal to retainer",
      states: ["PROPOSAL", "CONTRACT_PENDING", "RETAINER_PENDING", "BOOKED"],
      href: "/studio/projects?stage=booking",
      tone: "violet",
    },
    {
      label: "Planning",
      detail: "Details, crew & COI",
      states: ["PLANNING", "READY"],
      href: "/studio/projects?stage=planning",
      tone: "gold",
    },
    {
      label: "Event",
      detail: "Ready to capture",
      states: ["EVENT_COMPLETE"],
      href: "/studio/projects?stage=event",
      tone: "blue",
    },
    {
      label: "Delivery",
      detail: "Edit, album & review",
      states: ["POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"],
      href: "/studio/projects?stage=delivery",
      tone: "mint",
    },
  ].map((stage) => ({
    ...stage,
    value: projects.filter((project) =>
      stage.states.includes(String(project.state)),
    ).length,
  }));
  const greetingName =
    workspace.userName === workspace.tenantName
      ? ""
      : `, ${firstName(workspace.userName)}`;

  return (
    <>
      <section className="studio-command-hero">
        <div className="studio-command-copy">
          <p className="studio-command-kicker">
            <Sparkles size={14} />
            {current.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <h1>Good morning{greetingName}.</h1>
          <p>
            {loading
              ? "Gathering the work that needs you…"
              : error
                ? "Studio data is temporarily unavailable."
                : atRisk.length
                  ? `${atRisk.length} ${atRisk.length === 1 ? "project needs" : "projects need"} your attention. StudioCue can handle the rest.`
                  : active.length
                    ? "Your active projects are on track. Keep the momentum going."
                    : "Bring in your first project or teach StudioCue how your studio works."}
          </p>
          <div className="studio-command-actions">
            <Link className="studio-ai-primary" href="/studio/import">
              <Upload size={17} />
              Import my templates
              <ArrowUpRight size={15} />
            </Link>
            <Link className="studio-ai-secondary" href="/studio/copilot">
              <WandSparkles size={17} />
              Ask StudioCue
            </Link>
          </div>
        </div>
        <div className="studio-command-preview" aria-label="AI workflow preview">
          <div className="studio-command-orbit orbit-one" />
          <div className="studio-command-orbit orbit-two" />
          <span className="studio-command-badge">
            <Sparkles size={13} /> Suggested next
          </span>
          <strong>
            {atRisk[0]?.nextAction
              ? String(atRisk[0].nextAction)
              : "Import your wedding workflow"}
          </strong>
          <small>
            {atRisk[0]?.name
              ? String(atRisk[0].name)
              : "Upload a contract, email, questionnaire, or run of show."}
          </small>
          <Link
            href={
              atRisk[0]?.id
                ? `/studio/projects/${String(atRisk[0].id)}`
                : "/studio/import"
            }
          >
            Open workspace <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      <SetupChecklist />

      {workspace.role !== "staff_photographer" ? (
        <DashboardPriorityStrip />
      ) : null}

      <MobileTodayAgenda />

      {["studio_owner", "studio_admin"].includes(workspace.role ?? "") ? (
        <OwnerAutomationSignal />
      ) : null}

      <section className="lifecycle-overview" aria-label="Project lifecycle">
        <div className="lifecycle-heading">
          <span>
            <small>One connected workflow</small>
            <strong>Every project, from hello to gallery</strong>
          </span>
          <Link href="/studio/projects">
            All projects <ArrowRight size={14} />
          </Link>
        </div>
        <div className="lifecycle-rail">
          {lifecycle.map((stage, index) => (
            <Link
              className={`lifecycle-stage lifecycle-${stage.tone}`}
              href={stage.href}
              key={stage.label}
            >
              <span className="lifecycle-stage-number">
                {loading ? "—" : stage.value}
              </span>
              <span>
                <strong>{stage.label}</strong>
                <small>{stage.detail}</small>
              </span>
              {index < lifecycle.length - 1 ? (
                <ArrowRight className="lifecycle-arrow" size={15} />
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      <div className="dashboard-grid">
        <section className="panel today-panel">
          <div className="panel-heading">
            <div>
              <h2>Up next</h2>
              <p>One next step per project, in order</p>
            </div>
            <Link href="/studio/projects">
              All projects <ArrowRight size={14} />
            </Link>
          </div>
          <div className="today-list">
            {!loading && !active.length ? (
              <div className="dashboard-empty-action">
                <FolderKanban size={20} />
                <span>
                  <strong>Your first project starts here</strong>
                  <small>Add a client and event date, then StudioCue will guide the next steps.</small>
                </span>
                <Link href="/studio/projects/new">Create project <ArrowRight size={14} /></Link>
              </div>
            ) : (
              <JourneyUpNext />
            )}
          </div>
        </section>
        <section className="panel automation-next-panel">
          <div className="panel-heading">
            <div>
              <h2>Put AI to work</h2>
              <p>Recommended shortcuts for your studio</p>
            </div>
            <span className="automation-next-icon">
              <Sparkles size={17} />
            </span>
          </div>
          <div className="automation-next-list">
            <Link href="/studio/import">
              <span className="automation-next-art automation-coral">
                <FileText size={17} />
              </span>
              <span>
                <strong>Recreate your templates</strong>
                <small>Upload contracts, emails, forms, or schedules</small>
              </span>
              <ArrowRight size={15} />
            </Link>
            <Link href="/studio/questionnaires">
              <span className="automation-next-art automation-violet">
                <WandSparkles size={17} />
              </span>
              <span>
                <strong>Draft a wedding timeline</strong>
                <small>Use verified questionnaire answers</small>
              </span>
              <ArrowRight size={15} />
            </Link>
            <Link href="/studio/crew">
              <span className="automation-next-art automation-mint">
                <UserRoundCheck size={17} />
              </span>
              <span>
                <strong>Fill a crew role in order</strong>
                <small>Offer, wait, and cascade automatically</small>
              </span>
              <ArrowRight size={15} />
            </Link>
            <Link href="/studio/delivery">
              <span className="automation-next-art automation-blue">
                <Send size={17} />
              </span>
              <span>
                <strong>Run delivery follow-up</strong>
                <small>Gallery, album selections, and review reminders</small>
              </span>
              <ArrowRight size={15} />
            </Link>
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

function MobileTodayAgenda() {
  const workspace = useWorkspace();
  const tasks = useTenantDocuments("tasks");
  const consultations = useTenantDocuments("consultations", {
    enabled: workspace.role !== "staff_photographer",
  });
  const projects = useTenantDocuments("projects");
  const aiActions = useTenantDocuments("aiActions", {
    enabled: ["studio_owner", "studio_admin", "studio_coordinator"].includes(
      workspace.role ?? "",
    ),
  });
  const today = new Date().toISOString().slice(0, 10);
  const values = [
    ...(tasks.records ?? [])
      .filter(
        (task) =>
          !["complete", "completed", "cancelled"].includes(
            String(task.status),
          ) && String(task.dueDate ?? "").slice(0, 10) <= today,
      )
      .map((task) => ({
        id: `task-${task.id}`,
        label: String(task.title ?? task.name ?? "Task due"),
        detail:
          String(task.dueDate ?? "").slice(0, 10) < today
            ? "Overdue · Studio"
            : "Due today · Studio",
        href: task.projectId
          ? `/studio/projects/${String(task.projectId)}`
          : "/studio/tasks",
        tone: "urgent",
        icon: Clock3,
      })),
    ...(consultations.records ?? [])
      .filter(
        (consultation) =>
          String(consultation.startsAt ?? "").slice(0, 10) === today,
      )
      .map((consultation) => ({
        id: `consultation-${consultation.id}`,
        label: String(
          consultation.projectName ?? consultation.title ?? "Consultation",
        ),
        detail: `${new Date(String(consultation.startsAt)).toLocaleTimeString(
          undefined,
          { hour: "numeric", minute: "2-digit" },
        )} · Client`,
        href: "/studio/calendar",
        tone: "today",
        icon: CalendarDays,
      })),
    ...(aiActions.records ?? [])
      .filter((action) => action.status === "review_required")
      .map((action) => ({
        id: `ai-${action.id}`,
        label: String(action.title ?? "Review AI-prepared work"),
        detail: "Approval needed · Studio",
        href: "/studio/ai-queue",
        tone: "ai",
        icon: BrainCircuit,
      })),
    ...(projects.records ?? [])
      .filter(
        (project) =>
          activeStates.has(String(project.state)) &&
          Number(project.readinessScore ?? 0) < 100,
      )
      .map((project) => ({
        id: `project-${project.id}`,
        label: String(project.nextAction ?? "Review project readiness"),
        detail: `${String(project.name)} · ${Number(project.readinessScore ?? 0)}% ready`,
        href: `/studio/projects/${project.id}`,
        tone: "project",
        icon: CircleAlert,
      })),
  ].slice(0, 6);
  return (
    <section className="mobile-today-agenda" aria-label="Today’s agenda">
      <header>
        <span>
          <small>Mobile command view</small>
          <strong>Today</strong>
        </span>
        <em>{values.length} actions</em>
      </header>
      <div>
        {values.map((value) => {
          const Icon = value.icon;
          return (
            <Link href={value.href} key={value.id}>
              <span className={`is-${value.tone}`}><Icon size={16} /></span>
              <span><strong>{value.label}</strong><small>{value.detail}</small></span>
              <ArrowRight size={14} />
            </Link>
          );
        })}
        {!values.length ? (
          <p><ShieldCheck size={16} /> No urgent work right now.</p>
        ) : null}
      </div>
    </section>
  );
}

function DashboardPriorityStrip() {
  const workspace = useWorkspace();
  const tasksState = useTenantDocuments("tasks");
  const consultationsState = useTenantDocuments("consultations");
  const questionnaireState = useTenantDocuments("questionnaireResponses");
  const projectsState = useTenantDocuments("projects");
  const aiActionsState = useTenantDocuments("aiActions");
  const today = new Date().toISOString().slice(0, 10);
  const draftsWaiting = (aiActionsState.records ?? []).filter(
    (action) => String(action.status) === "review_required",
  );
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
      <Link href="/studio/ai-queue">
        <Sparkles />
        <span><small>Drafts waiting for approval</small><strong>{draftsWaiting.length}</strong></span>
        <ArrowRight />
      </Link>
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
