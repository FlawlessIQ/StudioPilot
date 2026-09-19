"use client";

import {
  resolveCoverage,
  totalCoverageCount,
} from "@/features/packages/coverage";
import { crewRequiredFromCoverage } from "@/features/crew/staffing-plan";
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
  const questionnaire = forProject(questionnaires.records)[0];
  const crew = forProject(crewAssignments.records);
  const projectRecord = (projects.records ?? []).find(
    (item) => item.id === projectId,
  );
  const bookedSnapshot = (packageSnapshots.records ?? []).find(
    (snapshot) => snapshot.id === text(projectRecord?.packageSnapshotId),
  );
  /**
   * Whether the package sends anyone besides the studio itself.
   *
   * Named for the photographer case it was written for, but the question is
   * "is there crew still to book" — a package of one photographer and one
   * videographer needs crew exactly as much as a two-photographer one, and
   * used to read as needing none.
   */
  const packageNeedsSecondShooter =
    totalCoverageCount(resolveCoverage(bookedSnapshot)) > 1;

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
    /**
     * The roles this job needs filled, from the package rather than from the
     * offers already made.
     *
     * This counted the assignments that existed, which is zero until somebody
     * is offered something — so a job that needed three people read as needing
     * none, and the fallback below supplied a flat 1 however large the package
     * was. The package has known the answer since it was selected. Offers
     * already out still count when they exceed it, because a studio that
     * chose to hire beyond the package has not made the package wrong.
     */
    crewRequired: Math.max(
      crew.length,
      crewRequiredFromCoverage(resolveCoverage(bookedSnapshot)),
    ),
    packageNeedsSecondShooter,
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
    insuranceRequired:
      text(
        (projects.records ?? []).find((item) => item.id === projectId)
          ?.insuranceRequired,
      ) || null,
  });
}
