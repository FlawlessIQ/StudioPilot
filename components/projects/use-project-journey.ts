"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  invoiceIsOverdue,
  projectJourney,
  type JourneyStep,
} from "@/features/journey/steps";
import {
  questionnaireHasAnswers,
} from "@/features/journey/substance";
import { useReadinessEvidence } from "@/components/projects/use-readiness-evidence";
import type { ReadinessEvidence } from "@/features/readiness/checkpoint-evidence";
import { displayableScheduleItems } from "@/features/schedules/item-clock";
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
  const leads = useTenantDocuments("leads");
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
  const finalInvoice = projectInvoices.find(
    (invoice) => invoice.kind === "final",
  );
  const dayBeforeAction = forProject(aiActions.records).find(
    (action) =>
      text(record(action.structuredOutput).trigger) === "day_before_checklist",
  );
  const coi = forProject(insuranceRequests.records).sort((left, right) =>
    text(right.createdAt).localeCompare(text(left.createdAt)),
  )[0];

  const readinessEvidence = useReadinessEvidence(projectId);

  const journey = projectJourney({
    projectId,
    state: projectState,
    eventDate,
    today: todayLocalIso(),
    lead: lead ? { id: lead.id, status: text(lead.status) || "new" } : null,
    hasConsultation: forProject(consultations.records).length > 0,
    proposalStatus:
      text(
        forProject(proposals.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
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
      text(forProject(questionnaires.records)[0]?.status) || null,
    // Status alone ticked this step while `answers` was `{}`.
    questionnaireHasAnswers: questionnaireHasAnswers(
      forProject(questionnaires.records)[0]?.answers,
    ),
    scheduleStatus: text(latestSchedule?.status) || null,
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
    crewAccepted: forProject(crewAssignments.records).filter(
      (assignment) => assignment.status === "accepted",
    ).length,
    // Every role offered on this job. Zero means solo — see JourneyInput.
    crewRequired: forProject(crewAssignments.records).length,
    settledCheckpointKeys: forProject(checkpoints.records)
      .filter((checkpoint) => ["complete", "waived"].includes(text(checkpoint.status)))
      .map((checkpoint) => text(checkpoint.templateKey))
      .filter(Boolean),
    crewCascadeActive: forProject(crewCascades.records).some(
      (cascade) => cascade.status === "active",
    ),
    coiStatus: text(coi?.status) || null,
    dayBeforeDraftStatus: text(dayBeforeAction?.status) || null,
    hasDelivery: forProject(deliveries.records).length > 0,
    albumOrReviewDone: ["REVIEW_REQUESTED", "CLOSED"].includes(projectState),
  });

  return { ...journey, readinessEvidence };
}
