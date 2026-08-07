"use client";

import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  CircleAlert,
  ContactRound,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import {
  LiveUpcomingRows,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { dailyCommandProjection } from "@/features/dashboard/daily-command-center";
import { activeProjectStates } from "@/features/dashboard/active-states";


function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function DashboardSummary() {
  const workspace = useWorkspace();
  const projects = useTenantDocuments("projects");
  const active = (projects.records ?? [])
    .filter((project) => activeProjectStates.has(String(project.state)))
    .sort((left, right) =>
      String(left.eventDate ?? "").localeCompare(String(right.eventDate ?? "")),
    );
  const needsAttention = active.filter(
    (project) => Number(project.readinessScore ?? 0) < 100,
  );
  const nextProject = needsAttention[0] ?? active[0];
  const greetingName =
    workspace.userName === workspace.tenantName
      ? ""
      : `, ${firstName(workspace.userName)}`;

  return (
    <>
      <section className="studio-focus-hero">
        <div className="studio-focus-copy">
          <p className="studio-command-kicker">
            <Sparkles size={14} /> Your next decision
          </p>
          <h1>Good morning{greetingName}.</h1>
          {projects.loading ? (
            <p>Finding the one thing that needs you now…</p>
          ) : nextProject ? (
            <>
              <span className="studio-focus-project">
                {String(nextProject.name)} · {String(nextProject.eventDate)}
              </span>
              <p>
                StudioCue has gathered the project context and prepared the next step.
                Review the recommendation, make the decision, and let the workflow continue.
              </p>
            </>
          ) : (
            <>
              <h2>Bring your first project into StudioCue</h2>
              <p>
                Start with a client and event date, or import the materials your studio
                already uses.
              </p>
            </>
          )}
        </div>
        <div className="studio-focus-action">
          <span className="studio-command-badge">
            <Sparkles size={13} /> Suggested next
          </span>
          <strong>
            {nextProject
              ? String(nextProject.nextAction ?? "Review project readiness")
              : "Create your first project"}
          </strong>
          <small>
            {nextProject
              ? String(nextProject.name)
              : "StudioCue will guide each next step from inquiry to delivery."}
          </small>
          <Link
            href={
              nextProject?.id
                ? `/studio/projects/${String(nextProject.id)}`
                : "/studio/projects/new"
            }
          >
            {nextProject ? "Review and decide" : "Create project"}
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {workspace.role !== "staff_photographer" ? <AttentionQueue /> : null}

      <SetupChecklist />

      <section className="panel projects-panel studio-projects-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your work</p>
            <h2>Projects needing attention</h2>
            <p>The three least-ready active projects, with the next decision for each.</p>
          </div>
          <Link href="/studio/projects">
            View all projects <ArrowRight size={14} />
          </Link>
        </div>
        <div className="project-table" role="table" aria-label="Upcoming projects">
          <div className="project-table-head" role="row">
            <span role="columnheader">Project</span>
            <span role="columnheader">Date</span>
            <span role="columnheader">Stage</span>
            <span role="columnheader">Readiness</span>
            <span role="columnheader">Next decision</span>
          </div>
          <LiveUpcomingRows limit={3} />
        </div>
      </section>
    </>
  );
}

function AttentionQueue() {
  const workspace = useWorkspace();
  const ownerOperations = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );
  const projects = useTenantDocuments("projects");
  const tasks = useTenantDocuments("tasks");
  const leads = useTenantDocuments("leads");
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
  const sources = [
    projects,
    leads,
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
  ];
  const loading = sources.some((source) => source.loading);
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
  const inquiryItems = (leads.records ?? [])
    .filter((lead) => !["converted", "lost", "archived"].includes(String(lead.status).toLowerCase()))
    .map((lead) => ({
      id: lead.id,
      title: String(lead.clientName ?? lead.name ?? lead.email ?? "New inquiry"),
      detail: "Review the inquiry and decide the next step.",
      href: `/studio/leads/${lead.id}`,
      kind: "Inquiry",
      icon: ContactRound,
    }));
  const items = [
    ...inquiryItems,
    ...projection.approvals.map((item) => ({
      ...item,
      kind: "Approval",
      icon: BrainCircuit,
    })),
    ...projection.exceptions.map((item) => ({
      ...item,
      kind: "Exception",
      icon: CircleAlert,
    })),
  ].slice(0, 5);

  if (!loading && !items.length) return null;

  return (
    <section className="panel studio-attention-queue" aria-label="Attention queue">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Attention queue</p>
          <h2>Only the decisions and exceptions that need you</h2>
        </div>
        {items.length ? (
          <Link href="/studio/ai-queue">
            Review all <ArrowRight size={14} />
          </Link>
        ) : null}
      </div>
      <div className="studio-attention-list">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link href={item.href} key={`${item.kind}-${item.id}`}>
              <span className={`studio-attention-icon is-${item.kind.toLowerCase()}`}>
                <Icon size={17} />
              </span>
              <span>
                <small>{item.kind}</small>
                <strong>{item.title}</strong>
                <em>{item.detail}</em>
              </span>
              <ArrowRight size={15} />
            </Link>
          );
        })}
        {loading && !items.length ? (
          <p><ShieldCheck size={16} /> Gathering work that needs your attention…</p>
        ) : null}
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
