"use client";

import { currentQuestionnaire } from "@/features/questionnaires/studio-edit";
import { projectProfile } from "@/features/job-kinds/job-kinds";
import { deliverableDueDate, deliveryProgress } from "@/features/post-event/deliverables";
import { jobExpectedDeliverables } from "@/features/post-event/job-deliverables";
import { currentFinalInvoice } from "@/features/booking/final-balance-due";
import { isLiveConsultation } from "@/features/consultations/live";
import {
  crewDemand,
  jobCoverage,
  jobPackageSnapshotIds,
  ownerShootsJob,
} from "@/features/crew/staffing-plan";
import { useState } from "react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { inquiryNextMove } from "@/features/inquiries/next-move";
import { useOutsideSteps } from "@/components/outside-steps/use-outside-steps";
import { useWorkspace } from "@/features/auth/workspace-context";
import { invoiceIsOverdue, projectJourney } from "@/features/journey/steps";
import { questionnaireHasAnswers } from "@/features/journey/substance";
import { displayableScheduleItems } from "@/features/schedules/item-clock";
import { todayLocalIso } from "@/lib/format/event-date";
import { activeProjectStates } from "@/features/dashboard/active-states";
import { useSetupState } from "@/components/setup/use-setup-state";
import { nextSetupStep, type SetupGapKey } from "@/features/today/setup-gaps";
import { homeMetrics, type HomeMetrics } from "@/features/dashboard/home-metrics";
import {
  bookedValueCents,
  handledThisWeek,
  todayInbox,
  type TodayInbox,
  type TodayJourneyPosition,
  type TodayRecord,
} from "@/features/today/inbox";
import { studioHasBookedAJob } from "@/features/journey/expected-timeline";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

type Row = Record<string, unknown> & { id: string };

/**
 * The last loaded records while a refresh is in flight, for the same studio.
 *
 * A refresh drops the cache to null so no page paints a pre-write list. For
 * Today, null leads or projects *is* the loading state: answering one "maybe
 * an inquiry" flipped the whole page to "Catching up…", unmounted the queue
 * and threw the reader back to the top. Today hides what was just answered
 * itself (its `cleared` set), so the list from before the write is safe to
 * keep on screen until the fresh read lands. Keyed by tenant so a studio
 * switch never shows the previous studio's records.
 */
function useKeptWhileReloading(
  records: Row[] | null,
  tenantId: string | null,
): Row[] | null {
  const [kept, setKept] = useState<{ tenantId: string | null; records: Row[] } | null>(null);
  if (records !== null && (kept?.records !== records || kept.tenantId !== tenantId))
    setKept({ tenantId, records });
  if (records !== null) return records;
  return kept && kept.tenantId === tenantId ? kept.records : null;
}

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
  /** Setup progress, and whether this studio has any work at all yet. */
  setup: {
    complete: boolean;
    answered: number;
    /** The next unanswered setup question, in setup's order. */
    next: SetupGapKey | null;
    brandNew: boolean;
    noInquiriesEver: boolean;
    /** Whether any job has ever booked: until one has, Today offers "A wedding, start to finish". */
    bookedAJob: boolean;
  };
  /** Value of work actually won — see bookedValueCents. */
  booked: number;
  handled: number;
  /**
   * Where every active job stands. Exposed so the Jobs table can name the
   * same next step Today names, instead of keeping its own opinion.
   */
  journeys: TodayJourneyPosition[];
  /** Raw AI action records, for opening a specific review in a sheet. */
  aiActions: TodayRecord[];
  /** Raw workflow approvals, for deciding one in a sheet on Today. */
  automationApprovals: TodayRecord[];
  loading: boolean;
} {
  const workspace = useWorkspace();
  const ownerOperations = ["studio_owner", "studio_admin"].includes(
    workspace.role ?? "",
  );

  const setup = useSetupState();
  const packageSnapshots = useTenantDocuments("packageSnapshots");
  const projectsRead = useTenantDocuments("projects");
  const leadsRead = useTenantDocuments("leads");
  const projects = {
    records: useKeptWhileReloading(projectsRead.records, workspace.tenantId),
  };
  const leads = {
    records: useKeptWhileReloading(leadsRead.records, workspace.tenantId),
  };
  const tasks = useTenantDocuments("tasks");
  const conversations = useTenantDocuments("conversations");
  const packageRequests = useTenantDocuments("packageRequests");
  const billingAddressRequests = useTenantDocuments("billingAddressRequests");
  const detailChangeRequests = useTenantDocuments("detailChangeRequests");
  const detailSignoffs = useTenantDocuments("detailSignoffs");
  // The studio's planning timeline: when Today starts offering "Send the form".
  const tenants = useTenantDocuments("tenants");
  const planningTimeline = tenants.records?.find((tenant) => tenant.id === workspace.tenantId)?.planningTimeline;
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
  const checkpoints = useTenantDocuments("checkpoints");
  const insuranceRequests = useTenantDocuments("insuranceRequests");
  // Who sends the studio's certificates (H3). Readable by the studio's
  // managers only, so nobody else asks.
  const coiSettings = useTenantDocuments("coiSettings", {
    enabled: ["studio_owner", "studio_admin", "studio_coordinator"].includes(String(workspace.role ?? "")),
  });
  const deliveries = useTenantDocuments("deliveryRecords");
  const questionnaireTemplates = useTenantDocuments("questionnaireTemplates");

  // Local, not UTC — a countdown must not move at 8pm. See todayLocalIso.
  const today = todayLocalIso();
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
      // The job page's crew reading, exactly: every package on the job, by
      // trade (crewDemand in features/crew/staffing-plan.ts).
      const snapshotIds = jobPackageSnapshotIds(project);
      const demand = crewDemand({
        coverage: jobCoverage(
          (packageSnapshots.records ?? []).filter((snapshot) =>
            snapshotIds.includes(snapshot.id),
          ),
        ),
        assignments: forProject(crewAssignments.records, projectId),
        ownerCovers: ownerShootsJob(project),
        scheduleVersion: Number(latestSchedule?.version ?? 0),
      });
      const { current } = projectJourney({
        projectId,
        profile: projectProfile(project),
        state: text(project.state),
        eventDate: text(project.eventDate) || null,
        today,
        lead: lead
          ? {
              id: lead.id,
              status: text(lead.status) || "new",
              replied: inquiryNextMove({
                conversations: conversations.records ?? [],
                projectId,
                leadId: lead.id,
                repliedOutsideAt: text(lead.repliedOutsideAt) || null,
              }).replied,
            }
          : null,
        // A cancelled or replaced consultation is not a booked meeting.
        hasConsultation: forProject(consultations.records, projectId).some(isLiveConsultation),
        proposalStatus:
          text(
            forProject(proposals.records, projectId).sort((left, right) =>
              text(right.createdAt).localeCompare(text(left.createdAt)),
            )[0]?.status,
          ) || null,
        bookingAgreementOut: forProject(contracts.records, projectId).some(
          (contract) => contract.mode === "combined" && ["sent", "viewed"].includes(text(contract.status)),
        ),
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
            currentFinalInvoice(projectInvoices)?.status,
          ) || null,
        finalInvoiceOverdue: invoiceIsOverdue(
          currentFinalInvoice(projectInvoices),
          today,
        ),
        questionnaireStatus:
          text(currentQuestionnaire(forProject(questionnaires.records, projectId))?.status) || null,
        questionnaireHasAnswers: questionnaireHasAnswers(
          currentQuestionnaire(forProject(questionnaires.records, projectId))?.answers,
        ),
        questionnaireSource:
          text(currentQuestionnaire(forProject(questionnaires.records, projectId))?.source) || null,
        scheduleStatus: text(latestSchedule?.status) || null,
        // The couple's answer to it: approved, or asked for changes.
        scheduleApprovalState: text(latestSchedule?.approvalState) || null,
        // Whether a form for this job type exists at all. Today used to offer
        // "Send the form" on a barn session for which no form existed, while
        // the job page — same engine, second caller — said "Build a form".
        hasSendableQuestionnaire: (questionnaireTemplates.records ?? []).some(
          (template) =>
            template.status === "active" &&
            String(template.eventTypeId ?? "") === text(project.eventTypeId),
        ),
        scheduleHasUsableItems:
          displayableScheduleItems(
            Array.isArray(latestSchedule?.items)
              ? (latestSchedule.items as Array<Record<string, unknown>>)
              : [],
          ).length > 0,
        // Same readings the job page uses, so Today and the job cannot
        // disagree about whether crew and insurance are outstanding. This
        // counted every assignment ever made as the requirement — a declined
        // offer held the step open — and never saw a videographer.
        crewAccepted: demand.crewAccepted,
        crewRequired: demand.crewRequired,
        packageNeedsSecondShooter: demand.packageNeedsCrew,
        settledCheckpointKeys: forProject(checkpoints.records, projectId)
          .filter((checkpoint) =>
            ["complete", "waived"].includes(text(checkpoint.status)),
          )
          .map((checkpoint) => text(checkpoint.templateKey))
          .filter(Boolean),
        crewCascadeActive: forProject(crewCascades.records, projectId).some(
          (cascade) => cascade.status === "active",
        ),
        coiStatus: text(coi?.status) || null,
        insuranceRequired: text(project?.insuranceRequired) || null,
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
        stepKey: current?.key ?? null,
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
        deliveryDue: ["EVENT_COMPLETE", "POST_PRODUCTION"].includes(text(project.state))
          ? nextDeliveryDue(
              project,
              // Every package, as the crew reading above: the film a photo +
              // video job owes is due too (Wave 2).
              (packageSnapshots.records ?? []).filter((snapshot) => snapshotIds.includes(snapshot.id)),
              forProject(deliveries.records, projectId),
            )
          : null,
      } satisfies TodayJourneyPosition;
    });

  const outsideSteps = useOutsideSteps();
  const inbox = todayInbox({
    now: new Date().toISOString(),
    projects: projects.records,
    leads: leads.records,
    conversations: conversations.records,
    packageRequests: packageRequests.records,
    billingAddressRequests: billingAddressRequests.records,
    detailChangeRequests: detailChangeRequests.records,
    detailSignoffs: detailSignoffs.records,
    planningTimeline,
    schedules: schedules.records,
    tasks: tasks.records,
    aiActions: aiActions.records,
    actionReceipts: actionReceipts.records,
    automationApprovals: automationApprovals.records,
    communicationDrafts: communicationDrafts.records,
    deliveryDrafts: deliveryDrafts.records,
    insuranceRequests: insuranceRequests.records,
    coiSettings: coiSettings.records,
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
    outsideStepReminders: outsideSteps.reminders,
  });

  const now = new Date();
  return {
    inbox,
    journeys,
    // The raw AI action records, so Today can open a specific prepared action's
    // full review in a sheet without re-fetching.
    aiActions: aiActions.records ?? [],
    automationApprovals: automationApprovals.records ?? [],
    /**
     * How far through the four setup questions this studio is, and whether it
     * has any real work yet.
     *
     * Today replaced the old dashboard, and the dashboard was the only place
     * that linked to the four-question setup flow — so a brand-new studio
     * landed on "You're all clear" with its onboarding two clicks deep in
     * Studio settings, under a nav item there is no reason to open on day one.
     *
     * `setupGaps` deliberately stays quiet for a new studio: "a studio with no
     * packages and no clients is not blocked, it is new." That rule is right
     * and this does not change it. An invitation is not a blocker.
     */
    setup: {
      complete: setup.complete,
      next: nextSetupStep(setup.gaps),
      answered: [
        setup.state.hasInquiryCapture !== false,
        setup.state.hasActivePackage,
        setup.state.hasAgreementTemplate,
        setup.state.hasQuestionnaireTemplate,
        setup.state.hasConsultationAvailability,
      ].filter(Boolean).length,
      // Genuinely new, as opposed to quiet: no jobs and no inquiries at all.
      brandNew:
        (projects.records ?? []).length === 0 &&
        (leads.records ?? []).length === 0,
      /**
       * No inquiry has ever reached StudioCue — by form or by forwarding.
       *
       * Not "none open": a studio that converted its only inquiry still has a
       * mailbox full of them, and is still one who has never been told the
       * forwarding address exists. This is the moment to say so.
       */
      noInquiriesEver: (leads.records ?? []).length === 0,
      bookedAJob: studioHasBookedAJob(projects.records),
    },
    // The studio's pulse, from the same engine the old dashboard used.
    metrics: homeMetrics({
      now,
      projects: projects.records,
      invoiceReferences: invoiceReferences.records,
    }),
    booked: bookedValueCents({
      projects: projects.records,
      packageSnapshots: packageSnapshots.records,
      proposals: proposals.records,
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

/**
 * The next final deliverable this job still owes, and its due date from the
 * package's turnaround (H4). Null when nothing final is outstanding.
 */
function nextDeliveryDue(
  project: Record<string, unknown>,
  snapshots: ReadonlyArray<Record<string, unknown>>,
  released: ReadonlyArray<Record<string, unknown>>,
): { label: string; date: string } | null {
  const expected = jobExpectedDeliverables(snapshots);
  const next = deliveryProgress(expected, released)
    .outstanding.filter((entry) => entry.final)
    .map((entry) => ({ entry, date: deliverableDueDate(typeof project.eventDate === "string" ? project.eventDate : null, entry) }))
    .filter((item): item is { entry: (typeof expected)[number]; date: string } => Boolean(item.date))
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  return next ? { label: next.entry.label, date: next.date } : null;
}
