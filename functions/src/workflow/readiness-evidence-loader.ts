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

import type { Firestore } from "firebase-admin/firestore";
import {
  readinessEvidenceFromFacts,
  type ReadinessEvidence,
} from "./checkpoint-evidence.js";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

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

  const [contracts, invoices, questionnaires, schedules, crew, insurance] =
    await Promise.all([
      forProject("contracts"),
      forProject("invoiceReferences"),
      forProject("questionnaireResponses"),
      forProject("schedules"),
      forProject("crewAssignments"),
      forProject("insuranceRequests"),
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
  const questionnaire = questionnaires.docs[0];

  return readinessEvidenceFromFacts({
    contractStatus: text(newestContract?.get("status")) || null,
    retainerInvoiceStatus:
      text(invoiceOfKind("retainer")?.get("status")) || null,
    finalInvoiceStatus: text(invoiceOfKind("final")?.get("status")) || null,
    questionnaireStatus: text(questionnaire?.get("status")) || null,
    questionnaireAnswers: questionnaire?.get("answers"),
    scheduleStatus: text(latestSchedule?.get("status")) || null,
    scheduleItems: Array.isArray(latestSchedule?.get("items"))
      ? (latestSchedule.get("items") as Array<Record<string, unknown>>)
      : [],
    crewAccepted: crew.docs.filter(
      (document) => document.get("status") === "accepted",
    ).length,
    // The roles this job needs filled: every assignment offered on it. Zero
    // means nobody was asked, which is a solo wedding.
    crewRequired: crew.size,
    // Against the current version, not merely "has acknowledged something".
    crewAcknowledgedCurrent: crew.docs.filter(
      (document) =>
        Number(document.get("acknowledgedScheduleVersion") ?? -1) ===
        Number(latestSchedule?.get("version") ?? 0),
    ).length,
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
  });
}
