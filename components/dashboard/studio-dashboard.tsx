"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  Clock3,
  FolderKanban,
  MailCheck,
  MapPin,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { SetupChecklist } from "@/components/dashboard/setup-checklist";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { ReadinessRing } from "@/components/ds/readiness-ring";
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

const monoTones = ["ds-mono-claret", "ds-mono-forest", "ds-mono-brass"];

function firstName(value: string) {
  return value.trim().split(/\s+/)[0] || "there";
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "··";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function stateBadge(state: string): { tone: string; label: string } {
  const label = state
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  if (state === "READY" || state === "DELIVERED") return { tone: "ds-badge-forest", label };
  if (["CONTRACT_PENDING", "RETAINER_PENDING", "PROPOSAL"].includes(state))
    return { tone: "ds-badge-amber", label };
  return { tone: "ds-badge-brass", label };
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
      <section className="ds-hero">
        <div className="ds-hero-copy">
          <span className="ds-eyebrow">
            {current.toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </span>
          <h1>
            Good morning<em>{greetingName}</em>.
          </h1>
          <p className="ds-hero-sub">
            {loading
              ? "Loading your operational priorities…"
              : error
                ? "Studio data is temporarily unavailable."
                : active.length
                  ? "Here’s what needs your attention today — StudioCue has the rest prepared."
                  : "Let’s set up the essentials for your first project."}
          </p>
        </div>
        <div className="ds-hero-actions">
          <Link
            className="ds-btn ds-btn-primary"
            href={active.length ? "/studio/projects" : "/studio/projects/new"}
          >
            <Plus size={16} /> {active.length ? "View projects" : "Create first project"}
          </Link>
        </div>
      </section>

      <SetupChecklist />

      {workspace.role !== "staff_photographer" ? <DashboardPriorityStrip /> : null}

      {["studio_owner", "studio_admin"].includes(workspace.role ?? "") ? (
        <OwnerAutomationSignal />
      ) : null}

      <section className="ds-stat-row" aria-label="Studio overview">
        <article className="ds-card ds-stat">
          <div className="ds-stat-top">
            <span className="ds-stat-label">Events this month</span>
            <span className="ds-stat-chip ds-chip-claret">
              <CalendarDays size={17} strokeWidth={1.9} />
            </span>
          </div>
          <div className="ds-stat-value">{loading ? "—" : eventsThisMonth}</div>
          <p className="ds-stat-note">From active project dates</p>
        </article>
        <article className="ds-card ds-stat">
          <div className="ds-stat-top">
            <span className="ds-stat-label">Projects ready</span>
            <span className="ds-stat-chip ds-chip-forest">
              <ShieldCheck size={17} strokeWidth={1.9} />
            </span>
          </div>
          <div className="ds-stat-value">
            {loading ? "—" : ready} <small>/ {loading ? "—" : active.length}</small>
          </div>
          <p className="ds-stat-note">Required event checks complete</p>
        </article>
        <article className="ds-card ds-stat">
          <div className="ds-stat-top">
            <span className="ds-stat-label">Needs your eye</span>
            <span className="ds-stat-chip ds-chip-amber">
              <CircleAlert size={17} strokeWidth={1.9} />
            </span>
          </div>
          <div className="ds-stat-value">{loading ? "—" : atRisk.length}</div>
          <p className="ds-stat-note is-warn">
            <CircleAlert size={13} /> Below 100% readiness
          </p>
        </article>
        <article className="ds-card ds-stat">
          <div className="ds-stat-top">
            <span className="ds-stat-label">Active projects</span>
            <span className="ds-stat-chip ds-chip-brass">
              <FolderKanban size={17} strokeWidth={1.9} />
            </span>
          </div>
          <div className="ds-stat-value">{loading ? "—" : active.length}</div>
          <p className="ds-stat-note">Cancelled &amp; archived excluded</p>
        </article>
      </section>

      <div className="ds-grid">
        <div className="ds-col">
          <section className="ds-card ds-card-pad">
            <div className="ds-section-head">
              <div>
                <h2>Needs your attention</h2>
                <p>The next decision on each project, ready to make</p>
              </div>
              <Link className="ds-seehead-link" href="/studio/projects">
                All projects <ArrowRight size={14} />
              </Link>
            </div>
            <div className="ds-attn">
              {atRisk
                .sort((a, b) =>
                  String(a.eventDate).localeCompare(String(b.eventDate)),
                )
                .slice(0, 4)
                .map((project, index) => {
                  const name = String(project.name);
                  const badge = stateBadge(String(project.state));
                  const meta = [
                    String(project.eventType ?? ""),
                    String(project.eventDate ?? ""),
                    String(project.venue ?? ""),
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <Link
                      className="ds-attn-row"
                      href={`/studio/projects/${project.id}`}
                      key={project.id}
                    >
                      <span className={`ds-monogram ${monoTones[index % 3]}`}>
                        {initials(name)}
                      </span>
                      <div className="ds-attn-body">
                        <div className="ds-attn-name">
                          {name}
                          <span className={`ds-badge ${badge.tone}`}>{badge.label}</span>
                        </div>
                        {meta ? <div className="ds-attn-meta">{meta}</div> : null}
                        <div className="ds-attn-next">
                          <MapPin size={14} />{" "}
                          {String(project.nextAction ?? "Review project readiness")}
                        </div>
                      </div>
                      <div className="ds-attn-right">
                        <ReadinessRing value={Number(project.readinessScore ?? 0)} />
                        <span className="ds-action">
                          Review <ArrowRight size={14} />
                        </span>
                      </div>
                    </Link>
                  );
                })}
              {!loading && !atRisk.length && active.length ? (
                <div className="ds-empty">
                  <ShieldCheck size={20} />
                  <span>
                    <strong>No active readiness blockers</strong>
                    <small>New required actions will appear here.</small>
                  </span>
                </div>
              ) : null}
              {!loading && !active.length ? (
                <div className="ds-empty">
                  <FolderKanban size={20} />
                  <span>
                    <strong>Your first project starts here</strong>
                    <small>
                      Add a client and event date, then StudioCue guides the next steps.
                    </small>
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <div className="ds-col">
          <PreparedCard />
          <section className="ds-card ds-card-pad">
            <div className="ds-section-head">
              <div>
                <h2>Pipeline</h2>
                <p>Active projects by stage</p>
              </div>
              <span className="ds-badge ds-badge-forest">
                <span className="ds-dot" /> Live
              </span>
            </div>
            <div className="ds-pipe">
              {pipeline.map((stage) => (
                <div className="ds-pipe-row" key={stage.label}>
                  <span>{stage.label}</span>
                  <span className="ds-pipe-track">
                    <span
                      className="ds-pipe-fill"
                      style={{ width: `${(stage.value / maxPipeline) * 100}%` }}
                    />
                  </span>
                  <strong>{loading ? "—" : stage.value}</strong>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function PreparedCard() {
  const approvals = useTenantDocuments("automationApprovals");
  const pending = (approvals.records ?? []).filter(
    (approval) => approval.status === "pending",
  );
  return (
    <section className="ds-card ds-ai">
      <div className="ds-ai-head">
        <span className="ds-ai-badge">
          <Sparkles size={16} />
        </span>
        <div>
          <strong>Prepared by StudioCue</strong>
          <small>{pending.length ? "Ready for your approval" : "You’re all caught up"}</small>
        </div>
      </div>
      {pending.length ? (
        <>
          <div className="ds-ai-draft">
            <span>Awaiting approval</span>
            <h4>
              {pending.length} item{pending.length > 1 ? "s" : ""} prepared for you
            </h4>
            <p>
              StudioCue drafted these from your projects and client details. Review
              before anything is sent.
            </p>
            <div className="ds-ai-actions">
              <Link className="ds-btn ds-btn-primary ds-btn-sm" href="/studio/automations">
                <Check size={15} /> Review &amp; approve
              </Link>
            </div>
          </div>
          <div className="ds-ai-note">
            <Check size={14} /> You approve every client-facing action — nothing is sent
            without you.
          </div>
        </>
      ) : (
        <div className="ds-empty" style={{ padding: 0 }}>
          <ShieldCheck size={18} />
          <span>
            <strong>Nothing needs approval</strong>
            <small>Drafts StudioCue prepares will appear here for your sign-off.</small>
          </span>
        </div>
      )}
    </section>
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
    <section className="ds-signal-row" aria-label="Today’s operational signals">
      <Link className="ds-card ds-signal" href="/studio/tasks">
        <span className="ds-signal-ico">
          <Clock3 size={17} />
        </span>
        <span className="ds-signal-copy">
          <small>Tasks due or overdue</small>
          <strong>{dueTasks.length}</strong>
        </span>
        <ArrowRight size={16} />
      </Link>
      {["studio_owner", "studio_admin"].includes(workspace.role ?? "") ? (
        <FinancialPrioritySignal />
      ) : (
        <Link className="ds-card ds-signal" href="/studio/projects">
          <span className="ds-signal-ico">
            <CircleAlert size={17} />
          </span>
          <span className="ds-signal-copy">
            <small>Projects needing action</small>
            <strong>{projectsNeedingAction.length}</strong>
          </span>
          <ArrowRight size={16} />
        </Link>
      )}
      <Link className="ds-card ds-signal" href="/studio/calendar">
        <span className="ds-signal-ico">
          <CalendarDays size={17} />
        </span>
        <span className="ds-signal-copy">
          <small>Consultations today</small>
          <strong>{todayConsultations.length}</strong>
        </span>
        <ArrowRight size={16} />
      </Link>
      <Link className="ds-card ds-signal" href="/studio/questionnaires">
        <span className="ds-signal-ico">
          <MailCheck size={17} />
        </span>
        <span className="ds-signal-copy">
          <small>Client details to review</small>
          <strong>{submittedQuestionnaires.length}</strong>
        </span>
        <ArrowRight size={16} />
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
    <Link className="ds-card ds-signal" href="/studio/invoices">
      <span className="ds-signal-ico">
        <ReceiptText size={17} />
      </span>
      <span className="ds-signal-copy">
        <small>Overdue balances</small>
        <strong>{overdueInvoices.length}</strong>
      </span>
      <ArrowRight size={16} />
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
    <section className="ds-card ds-alert">
      <span className="ds-alert-ico">
        <Workflow size={18} />
      </span>
      <div className="ds-alert-copy">
        <strong>Automation operations need review</strong>
        <small>
          {failures.length} failed runs · {pendingApprovals.length} approvals ·{" "}
          {integrationIssues.length} integration issues
        </small>
      </div>
      <Link className="ds-btn ds-btn-ghost ds-btn-sm" href="/studio/automations">
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
