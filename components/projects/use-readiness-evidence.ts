"use client";

import { currentQuestionnaire } from "@/features/questionnaires/studio-edit";
import { currentFinalInvoice } from "@/features/booking/final-balance-due";
import {
  crewDemand,
  jobCoverage,
  jobPackageSnapshotIds,
  ownerShootsJob,
} from "@/features/crew/staffing-plan";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { bookingIsConfirmed } from "@/features/inquiries/stages";
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
  const projects = useTenantDocuments("projects");
  const packageSnapshots = useTenantDocuments("packageSnapshots");

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
  const questionnaire = currentQuestionnaire(forProject(questionnaires.records));
  const crew = forProject(crewAssignments.records);
  const projectRecord = (projects.records ?? []).find(
    (item) => item.id === projectId,
  );
  /**
   * The crew this job needs, from every package on it and by trade.
   *
   * Read the primary package's photographers alone, so a photo + video
   * wedding never counted its videographer, and counted every assignment ever
   * made — a declined offer included — as a role still to fill. The server
   * scores readiness with the same helper (functions/src/workflow).
   */
  const snapshotIds = jobPackageSnapshotIds(projectRecord);
  const demand = crewDemand({
    coverage: jobCoverage(
      (packageSnapshots.records ?? []).filter((snapshot) =>
        snapshotIds.includes(snapshot.id),
      ),
    ),
    assignments: crew,
    ownerCovers: ownerShootsJob(projectRecord),
    scheduleVersion: Number(latestSchedule?.version ?? 0),
  });

  return readinessEvidenceFromFacts({
    bookingConfirmed: bookingIsConfirmed(projectRecord ?? {}),
    contractStatus: text(latestContract?.status) || null,
    retainerInvoiceStatus:
      text(projectInvoices.find((invoice) => invoice.kind === "retainer")?.status) ||
      null,
    finalInvoiceStatus:
      text(currentFinalInvoice(projectInvoices)?.status) ||
      null,
    questionnaireStatus: text(questionnaire?.status) || null,
    questionnaireAnswers: questionnaire?.answers,
    scheduleStatus: text(latestSchedule?.status) || null,
    scheduleItems: Array.isArray(latestSchedule?.items)
      ? (latestSchedule.items as Array<Record<string, unknown>>)
      : [],
    crewAccepted: demand.crewAccepted,
    crewRequired: demand.crewRequired,
    packageNeedsSecondShooter: demand.packageNeedsCrew,
    // Against the current version, not merely "has acknowledged something".
    crewAcknowledgedCurrent: demand.crewAcknowledgedCurrent,
    coiStatus:
      text(
        forProject(insuranceRequests.records).sort((left, right) =>
          text(right.createdAt).localeCompare(text(left.createdAt)),
        )[0]?.status,
      ) || null,
    insuranceRequired:
      text(
        (projects.records ?? []).find((item) => item.id === projectId)
          ?.insuranceRequired,
      ) || null,
  });
}
