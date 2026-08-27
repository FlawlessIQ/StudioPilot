"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  readinessEvidenceFromFacts,
  type ReadinessEvidence,
} from "@/features/readiness/checkpoint-evidence";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * What a project's own records prove, for the readiness meter.
 *
 * One implementation, shared by the job page and the event-day brief, because
 * the defect this closes was two parts of the product disagreeing about the
 * same five facts. A second copy of this derivation would be the same bug
 * waiting to happen.
 *
 * Reads from the shared tenant cache, so the collections are usually already
 * loaded by whatever else is on screen.
 */
export function useReadinessEvidence(projectId: string): ReadinessEvidence {
  const contracts = useTenantDocuments("contracts");
  const insuranceRequests = useTenantDocuments("insuranceRequests");
  const invoices = useTenantDocuments("invoiceReferences");
  const questionnaires = useTenantDocuments("questionnaireResponses");
  const schedules = useTenantDocuments("schedules");
  const crewAssignments = useTenantDocuments("crewAssignments");

  const forProject = (
    records: Array<Record<string, unknown> & { id: string }> | null,
  ) => (records ?? []).filter((item) => item.projectId === projectId);

  const projectInvoices = forProject(invoices.records);
  const latestSchedule = forProject(schedules.records).sort(
    (left, right) => Number(right.version ?? 0) - Number(left.version ?? 0),
  )[0];
  const latestContract = forProject(contracts.records).sort((left, right) =>
    text(right.createdAt).localeCompare(text(left.createdAt)),
  )[0];
  const questionnaire = forProject(questionnaires.records)[0];
  const crew = forProject(crewAssignments.records);

  return readinessEvidenceFromFacts({
    contractStatus: text(latestContract?.status) || null,
    retainerInvoiceStatus:
      text(projectInvoices.find((invoice) => invoice.kind === "retainer")?.status) ||
      null,
    finalInvoiceStatus:
      text(projectInvoices.find((invoice) => invoice.kind === "final")?.status) ||
      null,
    questionnaireStatus: text(questionnaire?.status) || null,
    questionnaireAnswers: questionnaire?.answers,
    scheduleStatus: text(latestSchedule?.status) || null,
    scheduleItems: Array.isArray(latestSchedule?.items)
      ? (latestSchedule.items as Array<Record<string, unknown>>)
      : [],
    crewAccepted: crew.filter((assignment) => assignment.status === "accepted")
      .length,
    // The roles this job actually needs filled: every assignment offered on it.
    // Zero means nobody was asked, which is a solo wedding.
    crewRequired: crew.length,
    // Against the current version, not merely "has acknowledged something".
    crewAcknowledgedCurrent: crew.filter(
      (assignment) =>
        Number(assignment.acknowledgedScheduleVersion ?? -1) ===
        Number(latestSchedule?.version ?? 0),
    ).length,
    coiStatus:
      text(
        forProject(insuranceRequests.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
  });
}
