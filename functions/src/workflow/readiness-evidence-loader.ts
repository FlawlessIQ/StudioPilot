/**
 * What a project's records prove, read from Firestore.
 *
 * `checkpoint-evidence.ts` holds the *rules* — pure, mirrored in `features/`,
 * tested there. This holds the *reads*, and exists because two callers need
 * the same answer and were not getting it:
 *
 *   - `reconcileProjectReadiness`, which scores the job, and
 *   - `resolveCheckpoint`, which refuses a completion whose dependencies are
 *     outstanding.
 *
 * Only the first had an evidence loader. So `checkpointSatisfied` was called
 * with evidence when scoring and *without* it when checking dependencies, and
 * the two disagreed about the same checkpoint: readiness counted "Retainer
 * paid" as satisfied from the paid invoice, while the dependency gate — reading
 * the checkpoint document, which automation never wrote — saw `not_started` and
 * threw DEPENDENCIES_INCOMPLETE. Every checkpoint downstream of a
 * record-satisfied one was unresolvable by hand, which on the starter wedding
 * template (each step depending on the one before it) meant all of them.
 *
 * The fix is one loader, used by both.
 */

import { paidInFullSettledByDeletion, settledInvoiceStatus } from "../billing/invoice-purge-policy.js";
import type { Firestore } from "firebase-admin/firestore";
import {
  readinessEvidenceFromFacts,
  type ReadinessEvidence,
} from "./checkpoint-evidence.js";
import {
  crewDemand,
  jobCoverage,
  jobPackageSnapshotIds,
  ownerShootsJob,
} from "../crew/staffing-plan.js";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const BOOKED_STATES = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
  "CLOSED",
]);

/**
 * Read the six collections readiness derives from and apply the rules.
 *
 * Reads outside any transaction on purpose: evidence is a projection of records
 * the caller does not modify, so transacting over all of them would buy
 * consistency nobody needs and contend with every other write to the job.
 */
export async function loadReadinessEvidence(
  db: Firestore,
  tenantId: string,
  projectId: string,
): Promise<ReadinessEvidence> {
  const forProject = (collection: string) =>
    db
      .collection(collection)
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .get();

  const [contracts, invoices, questionnaires, schedules, crew, insurance, project] =
    await Promise.all([
      forProject("contracts"),
      forProject("invoiceReferences"),
      forProject("questionnaireResponses"),
      forProject("schedules"),
      forProject("crewAssignments"),
      forProject("insuranceRequests"),
      // The job itself, for whether the venue asks for a certificate at all.
      db.doc(`projects/${projectId}`).get(),
    ]);

  const newestContract = contracts.docs
    .slice()
    .sort((left, right) =>
      text(right.get("createdAt")).localeCompare(text(left.get("createdAt"))),
    )[0];
  const invoiceOfKind = (kind: string) =>
    invoices.docs.find((document) => document.get("kind") === kind);
  const latestSchedule = schedules.docs
    .slice()
    .sort(
      (left, right) =>
        Number(right.get("version") ?? 0) - Number(left.get("version") ?? 0),
    )[0];
  // A withdrawn form is not the couple's questionnaire, and any other copy
  // they sent back is the one that counts.
  const liveQuestionnaires = questionnaires.docs.filter(
    (document) =>
      !document.get("archivedAt") && document.get("status") !== "withdrawn",
  );
  const questionnaire =
    liveQuestionnaires.find((document) =>
      ["submitted", "locked"].includes(text(document.get("status"))),
    ) ?? liveQuestionnaires[0];
  const ownProject = project.exists && project.get("tenantId") === tenantId;
  // Every package on the job, so a photo + video wedding needs its
  // videographer as well as its photographers (see crewDemand).
  const snapshots = ownProject
    ? (
        await Promise.all(
          jobPackageSnapshotIds(project.data()).map((id) =>
            db.doc(`packageSnapshots/${id}`).get(),
          ),
        )
      ).filter(
        (snapshot) => snapshot.exists && snapshot.get("tenantId") === tenantId,
      )
    : [];
  const demand = crewDemand({
    coverage: jobCoverage(snapshots.map((snapshot) => snapshot.data())),
    assignments: crew.docs.map((document) => document.data()),
    scheduleVersion: Number(latestSchedule?.get("version") ?? 0),
    ownerCovers: ownerShootsJob(project.data()),
  });

  // Past the booking gate means signed and paid, whatever the newest contract
  // record says. Mirrors bookingIsConfirmed in features/inquiries/stages.ts.
  const bookingConfirmed =
    ownProject &&
    ((typeof project.get("bookingCompletedAt") === "string" &&
      Boolean(project.get("bookingCompletedAt"))) ||
      BOOKED_STATES.has(text(project.get("state"))));
  return readinessEvidenceFromFacts({
    bookingConfirmed,
    contractStatus: text(newestContract?.get("status")) || null,
    // A paid bill the studio deleted leaves a settled note (own invoicing).
    retainerInvoiceStatus:
      text(invoiceOfKind("retainer")?.get("status")) || settledInvoiceStatus(project.data(), "retainer"),
    finalInvoiceStatus:
      text(invoiceOfKind("final")?.get("status")) ||
      settledInvoiceStatus(project.data(), "final") ||
      (paidInFullSettledByDeletion(project.data()) ? "paid" : null),
    questionnaireStatus: text(questionnaire?.get("status")) || null,
    questionnaireAnswers: questionnaire?.get("answers"),
    scheduleStatus: text(latestSchedule?.get("status")) || null,
    scheduleItems: Array.isArray(latestSchedule?.get("items"))
      ? (latestSchedule.get("items") as Array<Record<string, unknown>>)
      : [],
    // From every package on the job, by trade — not every assignment ever
    // made, which counted a declined offer as a role still to fill and a
    // second photographer's yes as the videographer's. Same helper as the
    // browser (features/crew/staffing-plan.ts), so the two cannot disagree.
    crewAccepted: demand.crewAccepted,
    crewRequired: demand.crewRequired,
    crewAcknowledgedCurrent: demand.crewAcknowledgedCurrent,
    coiStatus:
      text(
        insurance.docs
          .slice()
          .sort((left, right) =>
            text(right.get("createdAt")).localeCompare(
              text(left.get("createdAt")),
            ),
          )[0]
          ?.get("status"),
      ) || null,
    insuranceRequired: ownProject
      ? text(project.get("insuranceRequired")) || null
      : null,
  });
}
