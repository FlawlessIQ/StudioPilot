"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { invoiceIsOverdue, projectJourney } from "@/features/journey/steps";
import { activeProjectStates } from "@/features/dashboard/active-states";
import { useSetupState } from "@/components/setup/use-setup-state";
import { homeMetrics, type HomeMetrics } from "@/features/dashboard/home-metrics";
import {
  bookedValueCents,
  handledThisWeek,
  todayInbox,
  type TodayInbox,
  type TodayJourneyPosition,
} from "@/features/today/inbox";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type Row = Record<string, unknown> & { id: string };

/**
 * Everything Today needs, read once.
 *
 * `useTenantDocuments` shares a module-level cache with in-flight dedupe, so
 * every collection here costs one request no matter how many components ask
 * for it — which is what makes running the journey engine for *every* job on
 * the home page affordable.
 */
export function useTodayInbox(): {
  inbox: TodayInbox;
  metrics: HomeMetrics;
  /** Value of work actually won — see bookedValueCents. */
  booked: number;
  handled: number;
  /**
   * Where every active job stands. Exposed so the Jobs table can name the
   * same next step Today names, instead of keeping its own opinion.
   */
  journeys: TodayJourneyPosition[];
  loading: boolean;
} {
  const workspace = useWorkspace();
  const ownerOperations = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );

  const setup = useSetupState();
  const packageSnapshots = useTenantDocuments("packageSnapshots");
  const projects = useTenantDocuments("projects");
  const leads = useTenantDocuments("leads");
  const tasks = useTenantDocuments("tasks");
  const aiActions = useTenantDocuments("aiActions");
  const actionReceipts = useTenantDocuments("actionReceipts");
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
  // Journey inputs.
  const consultations = useTenantDocuments("consultations");
  const contracts = useTenantDocuments("contracts");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const crewAssignments = useTenantDocuments("crewAssignments");
  const insuranceRequests = useTenantDocuments("insuranceRequests");
  const deliveries = useTenantDocuments("deliveryRecords");

  const today = new Date().toISOString().slice(0, 10);
  const forProject = (rows: Row[] | null, projectId: string) =>
    (rows ?? []).filter((item) => item.projectId === projectId);

  // One journey position per active job, from the same engine the project
  // page uses — Today and the job page can never disagree about the step.
  const journeys: TodayJourneyPosition[] = (projects.records ?? [])
    .filter((project) => activeProjectStates.has(text(project.state)))
    .map((project) => {
      const projectId = project.id;
      const lead =
        (leads.records ?? []).find(
          (item) =>
            item.id === text(project.leadId) || item.projectId === projectId,
        ) ?? null;
      const projectInvoices = forProject(invoiceReferences.records, projectId);
      const latestSchedule = forProject(schedules.records, projectId).sort(
        (left, right) => Number(right.version ?? 0) - Number(left.version ?? 0),
      )[0];
      const coi = forProject(insuranceRequests.records, projectId).sort(
        (left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
      )[0];
      const dayBefore = forProject(aiActions.records, projectId).find(
        (action) =>
          text(record(action.structuredOutput).trigger) ===
          "day_before_checklist",
      );
      const { current } = projectJourney({
        projectId,
        state: text(project.state),
        eventDate: text(project.eventDate) || null,
        today,
        lead: lead ? { id: lead.id, status: text(lead.status) || "new" } : null,
        hasConsultation:
          forProject(consultations.records, projectId).length > 0,
        proposalStatus:
          text(
            forProject(proposals.records, projectId).sort((left, right) =>
              text(right.createdAt).localeCompare(text(left.createdAt)),
            )[0]?.status,
          ) || null,
        contractStatus:
          text(
            forProject(contracts.records, projectId).sort((left, right) =>
              text(right.createdAt).localeCompare(text(left.createdAt)),
            )[0]?.status,
          ) || null,
        retainerInvoiceStatus:
          text(
            projectInvoices.find((invoice) => invoice.kind === "retainer")
              ?.status,
          ) || null,
        finalInvoiceStatus:
          text(
            projectInvoices.find((invoice) => invoice.kind === "final")?.status,
          ) || null,
        finalInvoiceOverdue: invoiceIsOverdue(
          projectInvoices.find((invoice) => invoice.kind === "final"),
          today,
        ),
        questionnaireStatus:
          text(forProject(questionnaires.records, projectId)[0]?.status) || null,
        scheduleStatus: text(latestSchedule?.status) || null,
        crewAccepted: forProject(crewAssignments.records, projectId).filter(
          (assignment) => assignment.status === "accepted",
        ).length,
        crewCascadeActive: forProject(crewCascades.records, projectId).some(
          (cascade) => cascade.status === "active",
        ),
        coiStatus: text(coi?.status) || null,
        dayBeforeDraftStatus: text(dayBefore?.status) || null,
        hasDelivery: forProject(deliveries.records, projectId).length > 0,
        albumOrReviewDone: ["REVIEW_REQUESTED", "CLOSED"].includes(
          text(project.state),
        ),
      });
      return {
        projectId,
        projectName: text(project.name) || "Photography project",
        eventDate: text(project.eventDate) || null,
        state: text(project.state),
        stepTitle: current?.title ?? "In motion",
        stepDetail: current?.detail ?? "Nothing is due from you right now.",
        // No current step means nothing is owed by anyone right now; treat
        // it as in motion rather than inventing studio work.
        owner: current ? (current.owner ?? "studio") : "provider",
        actionLabel:
          current?.action?.kind === "link" ? current.action.label : null,
        actionHref:
          current?.action?.kind === "link" ? current.action.href : null,
        updatedAt: text(project.updatedAt) || null,
      } satisfies TodayJourneyPosition;
    });

  const inbox = todayInbox({
    now: new Date().toISOString(),
    leads: leads.records,
    tasks: tasks.records,
    aiActions: aiActions.records,
    actionReceipts: actionReceipts.records,
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
    journeys,
    setupGaps: setup.gaps,
  });

  const now = new Date();
  return {
    inbox,
    journeys,
    // The studio's pulse, from the same engine the old dashboard used.
    metrics: homeMetrics({
      now,
      projects: projects.records,
      invoiceReferences: invoiceReferences.records,
    }),
    booked: bookedValueCents({
      projects: projects.records,
      packageSnapshots: packageSnapshots.records,
    }),
    handled: handledThisWeek(
      {
        actionReceipts: actionReceipts.records,
        automationRuns: automationRuns.records,
        emailJobs: emailJobs.records,
      },
      now,
    ),
    loading: projects.records === null || leads.records === null,
  };
}
