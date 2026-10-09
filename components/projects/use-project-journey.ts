"use client";

import { isSalesConsultation } from "@/features/consultations/purpose";
import { finalCallState } from "@/features/consultations/final-call";
import { trialState } from "@/features/consultations/trial";
import { extensionsState } from "@/features/trades/extensions";
import { tradeProfile } from "@/features/trades/trades";
import { currentQuestionnaire } from "@/features/questionnaires/studio-edit";
import { journeyFor, projectProfile } from "@/features/job-kinds/job-kinds";
import { useWorkspace } from "@/features/auth/workspace-context";
import { currentFinalInvoice } from "@/features/booking/final-balance-due";
import { isLiveConsultation } from "@/features/consultations/live";
import {
  crewDemand,
  jobCoverage,
  jobPackageSnapshotIds,
  ownerShootsJob,
} from "@/features/crew/staffing-plan";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { inquiryNextMove } from "@/features/inquiries/next-move";
import {
  invoiceIsOverdue,
  projectJourney,
  type JourneyEvidence,
  type JourneyStep,
} from "@/features/journey/steps";
import { FILE_BEARING } from "@/features/documents/file-ref";
import {
  questionnaireHasAnswers,
} from "@/features/journey/substance";
import { useReadinessEvidence } from "@/components/projects/use-readiness-evidence";
import type { ReadinessEvidence } from "@/features/readiness/checkpoint-evidence";
import { displayableScheduleItems } from "@/features/schedules/item-clock";
import { finalHeadcountState } from "@/features/schedules/final-headcount";
import { todayLocalIso } from "@/lib/format/event-date";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * The project's position, computed once per page. The journey panel, the
 * next-move card, and the stage chip all read from this single derivation so
 * they can never disagree about where the project stands.
 */
export function useProjectJourney({
  projectId,
  projectState,
  eventDate,
  leadId,
}: {
  projectId: string;
  projectState: string;
  eventDate: string | null;
  leadId: string | null;
}): {
  steps: JourneyStep[];
  current: JourneyStep | null;
  /**
   * What these same records prove, for the readiness meter.
   *
   * Returned from here on purpose. Readiness and the journey used to disagree
   * about the same five facts — a booked wedding read 9/15 on the spine and 0%
   * on the meter, with the meter listing finished work as blockers — and one
   * derivation feeding both is what stops that recurring.
   */
  readinessEvidence: ReadinessEvidence;
} {
  const tenantTrade = useWorkspace().tenantTrade;
  const leads = useTenantDocuments("leads");
  const conversations = useTenantDocuments("conversations");
  const consultations = useTenantDocuments("consultations");
  const proposals = useTenantDocuments("proposals");
  const contracts = useTenantDocuments("contracts");
  const invoices = useTenantDocuments("invoiceReferences");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const crewAssignments = useTenantDocuments("crewAssignments");
  const checkpoints = useTenantDocuments("checkpoints");
  const questionnaireTemplates = useTenantDocuments("questionnaireTemplates");
  // The job's own event type, for deciding whether a form for it exists.
  const projectRecords = useTenantDocuments("projects");
  const crewCascades = useTenantDocuments("crewCascades");
  const insuranceRequests = useTenantDocuments("insuranceRequests");
  const deliveries = useTenantDocuments("deliveryRecords");
  const aiActions = useTenantDocuments("aiActions");
  const packageSnapshots = useTenantDocuments("packageSnapshots");
  // The studio's planning timeline: whether the final details call is on.
  const tenants = useTenantDocuments("tenants");
  // Hair extensions' order task (features/trades/extensions.ts).
  const tasks = useTenantDocuments("tasks");
  // A makeup or hair client's one-tap final headcount (features/schedules/final-headcount.ts).
  const detailSignoffs = useTenantDocuments("detailSignoffs");

  const forProject = (
    records: Array<Record<string, unknown> & { id: string }> | null,
  ) => (records ?? []).filter((item) => item.projectId === projectId);

  const lead =
    (leads.records ?? []).find(
      (item) => item.id === leadId || item.projectId === projectId,
    ) ?? null;
  const latestSchedule = forProject(schedules.records).sort(
    (left, right) => Number(right.version ?? 0) - Number(left.version ?? 0),
  )[0];
  const projectInvoices = forProject(invoices.records);
  const retainerInvoice = projectInvoices.find(
    (invoice) => invoice.kind === "retainer",
  );
  // The bill that stands, not whichever final came first (booking changes).
  const finalInvoice = currentFinalInvoice(projectInvoices);
  const dayBeforeAction = forProject(aiActions.records).find(
    (action) =>
      text(record(action.structuredOutput).trigger) === "day_before_checklist",
  );
  const coi = forProject(insuranceRequests.records).sort((left, right) =>
    text(right.createdAt).localeCompare(text(left.createdAt)),
  )[0];

  // The primary package says whether one has been chosen at all; the crew
  // count below reads every package on the job.
  const journeyProject = (projectRecords.records ?? []).find(
    (item) => item.id === projectId,
  );
  const bookedSnapshot = (packageSnapshots.records ?? []).find(
    (snapshot) => snapshot.id === text(journeyProject?.packageSnapshotId),
  );
  /**
   * The crew this job needs: every package on it, by trade. Same helper and
   * same inputs as use-readiness-evidence.ts — the rail and the readiness
   * panel answering one question two ways is the defect it replaces, and a
   * photo + video wedding used to read "crew confirmed" with no videographer.
   */
  const snapshotIds = jobPackageSnapshotIds(journeyProject);
  const demand = crewDemand({
    coverage: jobCoverage(
      (packageSnapshots.records ?? []).filter((snapshot) =>
        snapshotIds.includes(snapshot.id),
      ),
    ),
    assignments: forProject(crewAssignments.records),
    ownerCovers: ownerShootsJob(journeyProject),
    scheduleVersion: Number(latestSchedule?.version ?? 0),
  });

  const readinessEvidence = useReadinessEvidence(projectId);

  const newest = (records: Array<Record<string, unknown> & { id: string }>) =>
    [...records].sort((left, right) => text(right.createdAt).localeCompare(text(left.createdAt)))[0];
  const projectProposals = forProject(proposals.records);
  // The accepted one when there is one: that is the proposal the job rests on.
  const proposal =
    projectProposals.find((item) => item.status === "accepted") ?? newest(projectProposals);
  const contract = newest(forProject(contracts.records));
  const questionnaire = forProject(questionnaires.records)[0];
  /**
   * The specific record behind each step, and its files
   * (docs/document-access-plan-2026-09-28.md, 2.3). The rail's links were list
   * pages filtered by job and nothing on it opened a file.
   */
  const evidence: JourneyEvidence = {
    proposal: proposal
      ? { href: `/studio/proposals/${proposal.id}`, files: FILE_BEARING.proposals(proposal) }
      : undefined,
    contract: contract ? { files: FILE_BEARING.contracts(contract) } : undefined,
    retainer: retainerInvoice ? { files: FILE_BEARING.invoiceReferences(retainerInvoice) } : undefined,
    final_balance: finalInvoice ? { files: FILE_BEARING.invoiceReferences(finalInvoice) } : undefined,
    schedule_form: questionnaire
      ? {
          href: `/studio/questionnaires/${questionnaire.id}`,
          files: FILE_BEARING.questionnaireResponses(questionnaire),
        }
      : undefined,
    run_of_show: latestSchedule
      ? { href: `/studio/schedules/${latestSchedule.id}`, files: FILE_BEARING.schedules(latestSchedule) }
      : undefined,
    coi: coi ? { files: FILE_BEARING.insuranceRequests(coi) } : undefined,
    delivery: { files: forProject(deliveries.records).flatMap((delivery) => FILE_BEARING.deliveryRecords(delivery)) },
  };

  const journey = projectJourney({
    projectId,
    // Which steps this kind of job has (job-kinds.ts).
    profile: journeyProject ? projectProfile(journeyProject) : undefined,
    // What the studio does (trades.ts): a DJ has nothing to deliver.
    trade: tenantTrade,
    state: projectState,
    eventDate,
    today: todayLocalIso(),
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
    // The final details call a month out (features/consultations/final-call.ts);
    // a makeup or hair client's final headcount instead, confirmed in one tap
    // with no call (features/schedules/final-headcount.ts).
    finalCall: tradeProfile(tenantTrade).perPersonPricing
      ? finalHeadcountState({
          project: journeyProject ?? null,
          planningTimeline: (tenants.records ?? []).find((tenant) => tenant.id === text(journeyProject?.tenantId))?.planningTimeline,
          signoff: forProject(detailSignoffs.records)[0] ?? null,
          today: todayLocalIso(),
        })
      : finalCallState({
          project: journeyProject ?? null,
          planningTimeline: (tenants.records ?? []).find((tenant) => tenant.id === text(journeyProject?.tenantId))?.planningTimeline,
          consultations: forProject(consultations.records),
          today: todayLocalIso(),
          now: new Date().toISOString(),
        }),
    // A makeup or hair trial, when the trade has one (trades.ts).
    trial: trialState({ consultations: forProject(consultations.records), now: new Date().toISOString() }),
    // Hair extensions to buy or rent, from the trial notes.
    extensions: tradeProfile(tenantTrade).extensions
      ? extensionsState({ projectId, trialNotes: journeyProject?.trialNotes, eventDate, tasks: forProject(tasks.records) })
      : null,
    // The sales call; the final details call a month out is its own step.
    hasConsultation: forProject(consultations.records).some((record) => isSalesConsultation(record) && isLiveConsultation(record)),
    proposalStatus:
      text(
        forProject(proposals.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
    bookingAgreementOut: forProject(contracts.records).some(
      (contract) => contract.mode === "combined" && ["sent", "viewed"].includes(text(contract.status)),
    ),
    contractStatus:
      text(
        forProject(contracts.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
    retainerInvoiceStatus: text(retainerInvoice?.status) || null,
    finalInvoiceStatus: text(finalInvoice?.status) || null,
    finalInvoiceOverdue: invoiceIsOverdue(
      finalInvoice,
      todayLocalIso(),
    ),
    questionnaireStatus:
      text(currentQuestionnaire(forProject(questionnaires.records))?.status) || null,
    // Status alone ticked this step while `answers` was `{}`.
    questionnaireHasAnswers: questionnaireHasAnswers(
      currentQuestionnaire(forProject(questionnaires.records))?.answers,
    ),
    questionnaireSource:
      text(currentQuestionnaire(forProject(questionnaires.records))?.source) || null,
    scheduleStatus: text(latestSchedule?.status) || null,
    // The couple's answer to it: approved, or asked for changes.
    scheduleApprovalState: text(latestSchedule?.approvalState) || null,
    // And ticked Run of show on an approved schedule whose items no reader
    // could parse, while the couple's brief showed "Invalid Date" six times.
    scheduleHasUsableItems:
      displayableScheduleItems(
        Array.isArray(latestSchedule?.items)
          ? (latestSchedule.items as Array<Record<string, unknown>>)
          : [],
      ).length > 0,
    // Whether a form for this job type exists at all — see JourneyInput.
    hasSendableQuestionnaire: (questionnaireTemplates.records ?? []).some(
      (template) =>
        template.status === "active" &&
        String(template.eventTypeId ?? "") ===
          text(
            (projectRecords.records ?? []).find(
              (item) => item.id === projectId,
            )?.eventTypeId,
          ),
    ),
    crewAccepted: demand.crewAccepted,
    // Zero means solo — see JourneyInput. From the packages, by trade, and
    // never fewer than the people live on the job.
    crewRequired: demand.crewRequired,
    packageNeedsSecondShooter: demand.packageNeedsCrew,
    // No package locked yet means the crew question is unanswered, not solo.
    packageChosen: bookedSnapshot !== undefined,
    settledCheckpointKeys: forProject(checkpoints.records)
      .filter((checkpoint) => ["complete", "waived"].includes(text(checkpoint.status)))
      .map((checkpoint) => text(checkpoint.templateKey))
      .filter(Boolean),
    crewCascadeActive: forProject(crewCascades.records).some(
      (cascade) => cascade.status === "active",
    ),
    coiStatus: text(coi?.status) || null,
    insuranceRequired:
      text(
        (projectRecords.records ?? []).find((item) => item.id === projectId)
          ?.insuranceRequired,
      ) || null,
    dayBeforeDraftStatus: text(dayBeforeAction?.status) || null,
    hasDelivery: forProject(deliveries.records).length > 0,
    // A vendor's review is asked after the day itself (post-event/
    // after-day-reviews.ts): scheduled is as done as the studio can make it.
    albumOrReviewDone:
      ["REVIEW_REQUESTED", "CLOSED"].includes(projectState) ||
      (journeyFor(projectProfile(journeyProject), tradeProfile(tenantTrade)).reviewAfterDay &&
        typeof (journeyProject as { reviewRequestsScheduledAt?: unknown } | null | undefined)?.reviewRequestsScheduledAt === "string"),
    evidence,
  });

  return { ...journey, readinessEvidence };
}
