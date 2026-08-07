"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  MailCheck,
  ReceiptText,
  Sparkles,
  Workflow,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { activeProjectStates } from "@/features/dashboard/active-states";

/**
 * Counted operational signals for the studio home page.
 *
 * Preserved from the messaging/journey line of work. Not yet mounted on the
 * dashboard — wiring these in (alongside the money strip and the
 * `projection.working` feed) is Phase 1 of the rewiring plan.
 */
export function DashboardPriorityStrip() {
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
      activeProjectStates.has(String(project.state)) &&
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

export function FinancialPrioritySignal() {
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

export function OwnerAutomationSignal() {
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
