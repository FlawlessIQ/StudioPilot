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
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRoundCheck,
  WandSparkles,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { LiveUpcomingRows, useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dailyCommandProjection } from "@/features/dashboard/daily-command-center";

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
        <DailyCommandCenter />
      ) : null}

      <MobileTodayAgenda />

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

function DailyCommandCenter() {
  const workspace = useWorkspace();
  const ownerOperations = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const projects = useTenantDocuments("projects");
  const tasks = useTenantDocuments("tasks");
  const aiActions = useTenantDocuments("aiActions");
  const automationApprovals = useTenantDocuments("automationApprovals", {
    enabled: ownerOperations,
  });
  const communicationDrafts = useTenantDocuments("communicationDrafts");
  const deliveryDrafts = useTenantDocuments("deliveryDrafts");
  const proposals = useTenantDocuments("proposals");
  const automationRuns = useTenantDocuments("automationRuns", {
    enabled: ownerOperations,
  });
  const providerJobs = useTenantDocuments("providerJobs", {
    enabled: ownerOperations,
  });
  const emailJobs = useTenantDocuments("emailJobs");
  const integrationConnections = useTenantDocuments("integrationConnections", {
    enabled: ownerOperations,
  });
  const bookingOrchestrations = useTenantDocuments("bookingOrchestrations");
  const crewCascades = useTenantDocuments("crewCascades");
  const invoiceReferences = useTenantDocuments("invoiceReferences");
  const projection = dailyCommandProjection({
    now: new Date().toISOString(),
    projects: projects.records,
    tasks: tasks.records,
    aiActions: aiActions.records,
    automationApprovals: automationApprovals.records,
    communicationDrafts: communicationDrafts.records,
    deliveryDrafts: deliveryDrafts.records,
    proposals: proposals.records,
    automationRuns: automationRuns.records,
    providerJobs: providerJobs.records,
    emailJobs: emailJobs.records,
    integrationConnections: integrationConnections.records,
    bookingOrchestrations: bookingOrchestrations.records,
    crewCascades: crewCascades.records,
    invoiceReferences: invoiceReferences.records,
  });
  const lanes = [
    {
      key: "approvals",
      label: "Needs your approval",
      detail: "StudioCue prepared these decisions",
      icon: BrainCircuit,
      values: projection.approvals,
      empty: "Nothing is waiting for you.",
      href: "/studio/ai-queue",
    },
    {
      key: "exceptions",
      label: "Exceptions",
      detail: "Only work automation could not finish safely",
      icon: CircleAlert,
      values: projection.exceptions,
      empty: "No exceptions need attention.",
      href: "/studio/tasks",
    },
    {
      key: "working",
      label: "StudioCue is working",
      detail: "Active work you do not need to chase",
      icon: Workflow,
      values: projection.working,
      empty: "No background work is active.",
      href: "/studio/automations",
    },
  ] as const;
  const loading = [
    projects,
    tasks,
    aiActions,
    automationApprovals,
    communicationDrafts,
    deliveryDrafts,
    proposals,
    automationRuns,
    providerJobs,
    emailJobs,
    integrationConnections,
    bookingOrchestrations,
    crewCascades,
    invoiceReferences,
  ].some((state) => state.loading);

  return (
    <section className="daily-command-center" aria-label="Daily command center">
      <header>
        <span>
          <small>Your daily command center</small>
          <strong>Approve what matters. StudioCue handles the rest.</strong>
        </span>
        <Link href="/studio/ai-queue">
          Open all approvals <ArrowRight size={14} />
        </Link>
      </header>
      <div className="daily-command-lanes">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          return (
            <article className={`daily-command-lane is-${lane.key}`} key={lane.key}>
              <header>
                <span><Icon size={17} /></span>
                <div><strong>{lane.label}</strong><small>{lane.detail}</small></div>
                <em>{loading ? "—" : lane.values.length}</em>
              </header>
              <div>
                {lane.values.slice(0, 4).map((item) => (
                  <Link href={item.href} key={item.id}>
                    <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                    <ArrowRight size={14} />
                  </Link>
                ))}
                {!loading && !lane.values.length ? (
                  <p><ShieldCheck size={15} /> {lane.empty}</p>
                ) : null}
              </div>
              {lane.values.length > 4 ? (
                <Link className="daily-command-more" href={lane.href}>
                  View {lane.values.length - 4} more <ArrowRight size={13} />
                </Link>
              ) : null}
            </article>
          );
        })}
      </div>
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
