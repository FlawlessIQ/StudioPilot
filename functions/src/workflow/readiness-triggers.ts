/**
 * Readiness, recomputed when the records it is about change.
 *
 * The walk of 2026-08-26 found readiness pinned at 0% on a wedding whose
 * contract, retainer, questionnaire, run of show and crew were all done, and
 * `PLANNING → READY` unreachable by every path. Two things were missing: the
 * link from records to checkpoints (see ./checkpoint-evidence.ts) and an
 * occasion to recompute. `recalculateReadiness` existed as a command and
 * nothing in the product ever called it.
 *
 * These are that occasion. One handler, six thin triggers — the collections
 * that can change whether a job is ready. Chosen over a scheduled sweep so a
 * studio learns their wedding is ready at the moment it becomes ready, rather
 * than up to an hour later.
 *
 * Loop safety: the handler writes `projects`, `readinessAssessments` and
 * `auditEvents`, and watches none of them. It never writes a checkpoint, so
 * the checkpoint trigger cannot re-enter. The write is skipped entirely when
 * the score and state would not change, so a burst of edits to one job
 * settles rather than echoing.
 */

import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  calculateReadiness,
  writeReadiness,
  type CheckpointDocument,
} from "./commands.js";
import { loadReadinessEvidence } from "./readiness-evidence-loader.js";

const REGION = "us-east4";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/**
 * Recompute one project's readiness from its records, and let readiness
 * complete preparation if it is genuinely clear.
 *
 * Reads outside the transaction on purpose: readiness is a projection of
 * records this function does not modify, so a transaction over all of them
 * would buy consistency nobody needs and contend with every other write to
 * the job. The project row itself is read inside, because that is the row the
 * transition mutates.
 */
export async function reconcileProjectReadiness(
  db: Firestore,
  tenantId: string,
  projectId: string,
): Promise<{ changed: boolean; score: number; state: string } | null> {
  if (!tenantId || !projectId) return null;

  const [checkpointsSnapshot, evidence] = await Promise.all([
    db
      .collection("checkpoints")
      .where("tenantId", "==", tenantId)
      .where("projectId", "==", projectId)
      .where("archivedAt", "==", null)
      .get(),
    loadReadinessEvidence(db, tenantId, projectId),
  ]);

  // Nothing required means nothing to say — a job before planning is not a
  // job at 0%.
  const checkpoints = checkpointsSnapshot.docs.map(
    (document) =>
      ({ id: document.id, ...document.data() }) as CheckpointDocument,
  );
  if (!checkpoints.some((checkpoint) => checkpoint.blocking)) return null;

  const timestamp = new Date().toISOString();
  const projectReference = db.doc(`projects/${projectId}`);

  return db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectReference);
    if (!project.exists || project.get("tenantId") !== tenantId) return null;

    const state = text(project.get("state"));
    const preview = calculateReadiness(checkpoints, timestamp, evidence);
    const advancing =
      state === "PLANNING" &&
      preview.ready &&
      preview.blockingItems.length === 0;

    // A no-op recompute must not write. Without this, one edit to a job would
    // touch its project row, and anything watching projects would see churn
    // that means nothing.
    if (
      !advancing &&
      Number(project.get("readinessScore") ?? -1) === preview.score
    ) {
      return { changed: false, score: preview.score, state };
    }

    const projection = await writeReadiness(transaction, db, {
      tenantId,
      projectId,
      workflowRunId: checkpoints[0]?.workflowRunId ?? null,
      checkpoints,
      timestamp,
      actorId: "readiness-reconciler",
      evidence,
      project: {
        state,
        stateVersion: Number(project.get("stateVersion") ?? 0),
      },
    });
    return {
      changed: true,
      score: projection.score,
      state: advancing ? "READY" : state,
    };
  });
}

/** The document's own tenant and project, when it names both. */
function target(
  data: Record<string, unknown> | undefined,
): { tenantId: string; projectId: string } | null {
  const tenantId = text(data?.tenantId);
  const projectId = text(data?.projectId);
  return tenantId && projectId ? { tenantId, projectId } : null;
}

function readinessTriggerFor(collection: string) {
  return onDocumentWritten(
    { document: `${collection}/{documentId}`, region: REGION },
    async (event) => {
      // Deletion is delivered here too, and a deleted record can only ever
      // lower readiness, so the `before` snapshot is the fallback.
      const where =
        target(event.data?.after?.data()) ?? target(event.data?.before?.data());
      if (!where) return;
      await reconcileProjectReadiness(
        getFirestore(),
        where.tenantId,
        where.projectId,
      );
    },
  );
}

export const readinessOnCheckpointWritten = readinessTriggerFor("checkpoints");
export const readinessOnContractWritten = readinessTriggerFor("contracts");
export const readinessOnInvoiceWritten =
  readinessTriggerFor("invoiceReferences");
export const readinessOnQuestionnaireWritten = readinessTriggerFor(
  "questionnaireResponses",
);
export const readinessOnScheduleWritten = readinessTriggerFor("schedules");
export const readinessOnCrewAssignmentWritten =
  readinessTriggerFor("crewAssignments");
/**
 * Added when the COI stopped being a judgement: `sendCoiToVenue` writes the
 * status readiness now reads, so that write needs to be an occasion to
 * recompute like every other.
 */
export const readinessOnInsuranceRequestWritten =
  readinessTriggerFor("insuranceRequests");

/**
 * The occasion that was missing: the project entering preparation.
 *
 * Every other trigger here watches a *record* readiness reads. But a job can
 * reach 100% while it is still BOOKED — the walk of 2026-08-27 drove one to
 * 12/12 a year before the wedding — and then move to PLANNING by hand. At that
 * moment nothing readiness watches changes, so `PLANNING → READY` never fired
 * and the job sat at "100% · nothing blocking · Planning" indefinitely, with no
 * button anywhere that could finish it.
 *
 * Deliberately narrow, because this is the one trigger that watches the
 * collection the reconciler writes:
 *
 *   - only when the state actually changed, so a readiness-score write cannot
 *     re-enter, and
 *   - only when the new state is PLANNING, so the reconciler's own
 *     `PLANNING → READY` write terminates on the next delivery.
 */
export const readinessOnProjectPlanning = onDocumentWritten(
  { document: "projects/{projectId}", region: REGION },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    if (text(before?.state) === text(after.state)) return;
    if (text(after.state) !== "PLANNING") return;
    const where = target(after);
    if (!where) return;
    await reconcileProjectReadiness(
      getFirestore(),
      where.tenantId,
      where.projectId,
    );
  },
);
