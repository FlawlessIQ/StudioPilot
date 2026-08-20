"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  projectJourney,
  type JourneyStep,
} from "@/features/journey/steps";

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
}): { steps: JourneyStep[]; current: JourneyStep | null } {
  const leads = useTenantDocuments("leads");
  const consultations = useTenantDocuments("consultations");
  const proposals = useTenantDocuments("proposals");
  const contracts = useTenantDocuments("contracts");
  const invoices = useTenantDocuments("invoiceReferences");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const crewAssignments = useTenantDocuments("crewAssignments");
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

  return projectJourney({
    projectId,
    state: projectState,
    eventDate,
    today: new Date().toISOString().slice(0, 10),
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
    questionnaireStatus:
      text(forProject(questionnaires.records)[0]?.status) || null,
    scheduleStatus: text(latestSchedule?.status) || null,
    crewAccepted: forProject(crewAssignments.records).filter(
      (assignment) => assignment.status === "accepted",
    ).length,
    crewCascadeActive: forProject(crewCascades.records).some(
      (cascade) => cascade.status === "active",
    ),
    coiStatus: text(coi?.status) || null,
    dayBeforeDraftStatus: text(dayBeforeAction?.status) || null,
    hasDelivery: forProject(deliveries.records).length > 0,
    albumOrReviewDone: ["REVIEW_REQUESTED", "CLOSED"].includes(projectState),
  });
}
