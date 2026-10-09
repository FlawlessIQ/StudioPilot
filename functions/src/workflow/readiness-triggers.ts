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
 * `auditEvents`. The project trigger below ignores those writes (it fires on
 * a change of state or of the insurance answer, and this writes neither). It
 * writes one checkpoint, once — a vendor's certificate check, added under an
 * id derived from the run or taken back up from the backfill's waiver — and
 * the checkpoint trigger that write fires finds it already in place and
 * changes nothing. The write is skipped entirely when the
 * score and state would not change, so a burst of edits to one job settles
 * rather than echoing.
 */

import {
  FieldValue,
  getFirestore,
  type Firestore,
} from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import {
  calculateReadiness,
  resolveDueDate,
  writeReadiness,
  type CheckpointDocument,
} from "./commands.js";
import { loadReadinessEvidence } from "./readiness-evidence-loader.js";
import {
  INSURANCE_CHECK_KEY,
  VENDOR_JOURNEY_WAIVER,
  insuranceCheckChange,
  insuranceCheckpointTemplate,
} from "./starter-templates.js";
import { tradeProfile } from "../trades/trades.js";

const REGION = "us-east4";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const RECONCILER = "readiness-reconciler";

/** Whether this studio's trade leaves insurance to the venue (trades.ts `journey`). */
async function leavesInsuranceToTheVenue(
  db: Firestore,
  tenantId: string,
): Promise<boolean> {
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  return !tradeProfile(tenant.get("trade")).journey.insuranceByDefault;
}

/** One certificate check per run, whichever delivery gets there first. */
export function insuranceCheckId(workflowRunId: string): string {
  return `${workflowRunId}_${INSURANCE_CHECK_KEY}`;
}

/** The certificate check to add to a job, or to take back up, as it will be written. */
type InsuranceCheckChange = {
  kind: "add" | "reopen";
  checkpoint: CheckpointDocument;
};

/**
 * The certificate check a vendor's job now needs, built but not written.
 *
 * A vendor's four checks leave insurance out (workflow/starter-templates.ts);
 * when the venue asks — the studio's switch on the job, the couple's answer on
 * the inquiry, or Cue's flag — the job carries the check a photographer's
 * does, on whichever path set the answer and whenever the run began. A job
 * whose check was waived by the vendor backfill has that one taken back up.
 * Read in the order that stops soonest: a job already carrying a live check
 * (every photographer's starter wedding) reads nothing more, and one whose
 * venue has not asked never reads the studio.
 */
async function insuranceCheckChangeFor(
  db: Firestore,
  tenantId: string,
  projectId: string,
  checkpoints: readonly CheckpointDocument[],
  timestamp: string,
): Promise<InsuranceCheckChange | null> {
  const checks = checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    templateKey: text(checkpoint.templateKey),
    status: text(checkpoint.status),
    waiverReason: checkpoint.waiverReason,
  }));
  const carried = checks.filter((check) => check.templateKey === INSURANCE_CHECK_KEY);
  if (carried.some((check) => !(check.status === "waived" && check.waiverReason === VENDOR_JOURNEY_WAIVER)))
    return null;
  const workflowRunId = checkpoints.find((checkpoint) => checkpoint.workflowRunId)?.workflowRunId;
  if (!workflowRunId) return null;
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) return null;
  if (project.get("insuranceRequired") !== "required") return null;
  const tenant = await db.doc(`tenants/${tenantId}`).get();
  const change = insuranceCheckChange({
    insuranceByDefault: tradeProfile(tenant.get("trade")).journey.insuranceByDefault,
    insuranceRequired: project.get("insuranceRequired"),
    checks,
  });
  if (!change) return null;
  if (change.kind === "reopen") {
    const waived = checkpoints.find((checkpoint) => checkpoint.id === change.id);
    if (!waived) return null;
    return {
      kind: "reopen",
      checkpoint: {
        ...waived,
        status: "ready",
        completionTimestamp: null,
        completionActorId: null,
        notes: null,
        waiverReason: null,
        waiverExpiresAt: null,
        updatedAt: timestamp,
        updatedBy: RECONCILER,
      },
    };
  }
  const eventDate = text(project.get("eventDate")).slice(0, 10);
  if (!eventDate) return null;
  const definition = insuranceCheckpointTemplate();
  return {
    kind: "add",
    checkpoint: {
      id: insuranceCheckId(workflowRunId),
      tenantId,
      projectId,
      workflowRunId,
      templateKey: definition.key,
      name: definition.name,
      description: definition.description,
      category: definition.category,
      ownerType: definition.ownerType,
      assignedUserId: definition.assignedUserId,
      assignedContactId: definition.assignedContactId,
      dueDateRule: definition.dueDateRule,
      resolvedDueDate: resolveDueDate(definition.dueDateRule, {
        eventDate,
        projectCreated: text(project.get("createdAt")).slice(0, 10) || timestamp.slice(0, 10),
        bookingDate: null,
        workflowStarted: timestamp.slice(0, 10),
      }),
      visibility: definition.visibility,
      blocking: definition.blocking,
      dependencyIds: [],
      completionMethod: definition.completionMethod,
      requiredEvidence: definition.requiredEvidence,
      reminderRules: definition.reminderRules,
      escalationRules: definition.escalationRules,
      waiverAllowed: definition.waiverAllowed,
      status: "ready",
      completionTimestamp: null,
      completionActorId: null,
      evidence: [],
      notes: null,
      waiverReason: null,
      waiverExpiresAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: RECONCILER,
      updatedBy: RECONCILER,
      archivedAt: null,
    },
  };
}

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

  const checkpoints = checkpointsSnapshot.docs.map(
    (document) =>
      ({ id: document.id, ...document.data() }) as CheckpointDocument,
  );
  /**
   * Nothing required means nothing to say — a job before planning is not a job
   * at 0%. But it must not mean nothing to *do*, either.
   *
   * `PLANNING → READY` is readiness-controlled, so `transitionProject` refuses
   * it and this function is the only performer. Returning early on a project
   * with no blocking checkpoints — a tenant whose event type has no workflow
   * template, or a studio that archived the starter ones — left that project
   * stuck at PLANNING for good: no checkpoints to complete, no score to reach,
   * and no manual override anywhere.
   *
   * A job with no readiness requirements is ready by definition. So the early
   * return still skips the *scoring* (there is no number to write), but a
   * project already sitting in PLANNING is advanced.
   */
  if (!checkpoints.some((checkpoint) => checkpoint.blocking)) {
    return advanceUnrequiredProject(db, tenantId, projectId);
  }

  const timestamp = new Date().toISOString();
  const projectReference = db.doc(`projects/${projectId}`);
  const insurance = await insuranceCheckChangeFor(
    db,
    tenantId,
    projectId,
    checkpoints,
    timestamp,
  );

  return db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectReference);
    if (!project.exists || project.get("tenantId") !== tenantId) return null;
    // Re-read inside: two deliveries for the same job must change the check
    // once, and only on a run that is still going.
    const insuranceReference = insurance
      ? db.doc(`checkpoints/${insurance.checkpoint.id}`)
      : null;
    const [insuranceSnapshot, insuranceRun] =
      insurance && insuranceReference
        ? await Promise.all([
            transaction.get(insuranceReference),
            transaction.get(
              db.doc(`workflowRuns/${insurance.checkpoint.workflowRunId}`),
            ),
          ])
        : [null, null];
    const runIsLive =
      insuranceRun?.exists === true &&
      insuranceRun.get("tenantId") === tenantId &&
      insuranceRun.get("status") === "active";
    const insuranceChange =
      insurance && runIsLive
        ? insurance.kind === "add"
          ? insuranceSnapshot?.exists === false
            ? insurance
            : null
          : insuranceSnapshot?.get("status") === "waived" &&
              insuranceSnapshot.get("waiverReason") === VENDOR_JOURNEY_WAIVER
            ? insurance
            : null
        : null;
    const scored = !insuranceChange
      ? checkpoints
      : insuranceChange.kind === "add"
        ? [...checkpoints, insuranceChange.checkpoint]
        : checkpoints.map((checkpoint) =>
            checkpoint.id === insuranceChange.checkpoint.id
              ? insuranceChange.checkpoint
              : checkpoint,
          );

    const state = text(project.get("state"));
    const preview = calculateReadiness(scored, timestamp, evidence);
    const advancing =
      state === "PLANNING" &&
      preview.ready &&
      preview.blockingItems.length === 0;

    // A no-op recompute must not write. Without this, one edit to a job would
    // touch its project row, and anything watching projects would see churn
    // that means nothing.
    if (
      !insuranceChange &&
      !advancing &&
      Number(project.get("readinessScore") ?? -1) === preview.score
    ) {
      return { changed: false, score: preview.score, state };
    }

    if (insuranceChange && insuranceReference) {
      const { checkpoint } = insuranceChange;
      if (insuranceChange.kind === "add") {
        transaction.create(insuranceReference, checkpoint);
        transaction.update(db.doc(`workflowRuns/${checkpoint.workflowRunId}`), {
          checkpointIds: FieldValue.arrayUnion(checkpoint.id),
          updatedAt: timestamp,
          updatedBy: RECONCILER,
        });
      } else {
        transaction.update(insuranceReference, {
          status: checkpoint.status,
          completionTimestamp: null,
          completionActorId: null,
          notes: null,
          waiverReason: null,
          waiverExpiresAt: null,
          updatedAt: timestamp,
          updatedBy: RECONCILER,
        });
      }
      // A check appearing, or coming back, with nobody having touched it is
      // exactly what the audit log is for.
      const auditId = `audit_insurance_check_${insuranceChange.kind}_${checkpoint.id}_${timestamp}`
        .replace(/[^A-Za-z0-9_-]/g, "_");
      transaction.set(db.doc(`auditEvents/${auditId}`), {
        id: auditId,
        tenantId,
        projectId,
        actorId: RECONCILER,
        actorType: "system",
        action: insuranceChange.kind === "add" ? "checkpoint.added" : "checkpoint.reopened",
        entityType: "checkpoint",
        entityId: checkpoint.id,
        timestamp,
        before: insuranceChange.kind === "add" ? null : { status: "waived", waiverReason: VENDOR_JOURNEY_WAIVER },
        after: {
          templateKey: INSURANCE_CHECK_KEY,
          status: checkpoint.status,
          reason: "The venue needs insurance",
        },
        ipAddress: null,
        userAgent: null,
        correlationId: auditId,
        automationRunId: checkpoint.workflowRunId,
        providerEventId: null,
      });
    }

    const projection = await writeReadiness(transaction, db, {
      tenantId,
      projectId,
      workflowRunId: checkpoints[0]?.workflowRunId ?? null,
      checkpoints: scored,
      timestamp,
      actorId: RECONCILER,
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

/**
 * Advance a project that has nothing to be ready for.
 *
 * Only from PLANNING, only forward, and with the same optimistic-concurrency
 * shape as the scored path. A project with no blocking checkpoints has no
 * readiness assessment to write, so this writes the state and the audit trail
 * and nothing else.
 */
async function advanceUnrequiredProject(
  db: Firestore,
  tenantId: string,
  projectId: string,
): Promise<{ changed: boolean; score: number; state: string } | null> {
  const timestamp = new Date().toISOString();
  const projectReference = db.doc(`projects/${projectId}`);
  return db.runTransaction(async (transaction) => {
    const project = await transaction.get(projectReference);
    if (!project.exists || project.get("tenantId") !== tenantId) return null;
    const state = text(project.get("state"));
    if (state !== "PLANNING") return null;
    const stateVersion = Number(project.get("stateVersion") ?? 0);
    transaction.update(projectReference, {
      state: "READY",
      stateVersion: stateVersion + 1,
      updatedAt: timestamp,
      updatedBy: "readiness-reconciler",
    });
    const auditId = `audit_readiness_unrequired_${projectId}_${stateVersion}`;
    transaction.set(db.doc(`auditEvents/${auditId}`), {
      id: auditId,
      tenantId,
      projectId,
      actorId: "readiness-reconciler",
      actorType: "system",
      action: "project.state_changed",
      entityType: "project",
      entityId: projectId,
      timestamp,
      before: { state, stateVersion },
      after: {
        state: "READY",
        stateVersion: stateVersion + 1,
        // Said explicitly, because "ready with no checkpoints" is a claim a
        // studio may want to question later.
        reason: "No blocking readiness checkpoints exist for this project",
      },
      ipAddress: null,
      userAgent: null,
      correlationId: auditId,
      automationRunId: null,
      providerEventId: null,
    });
    return { changed: true, score: 0, state: "READY" };
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
 *
 * And one more occasion, as narrow: a vendor's venue turning out to need
 * insurance, or not (simpler vendor journeys, 2026-10-09). The answer is a
 * field on the job, not a record readiness watches, so without this the
 * certificate check would arrive only with the next unrelated write — and
 * marking it not needed would leave it blocking until then. The reconciler
 * never writes `insuranceRequired`, so this cannot re-enter either. Only for
 * a trade that leaves insurance to the venue: a photographer's jobs carry
 * the check from the start and recompute as they always have.
 */
export const readinessOnProjectPlanning = onDocumentWritten(
  { document: "projects/{projectId}", region: REGION },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;
    const where = target(after);
    if (!where) return;
    const enteredPlanning =
      text(before?.state) !== text(after.state) &&
      text(after.state) === "PLANNING";
    // A job created with an answer has no run yet: booking starts one, with
    // the check (the checkpoint trigger reconciles it).
    const insuranceAnswered =
      before !== undefined &&
      text(before.insuranceRequired) !== text(after.insuranceRequired);
    if (!enteredPlanning && !insuranceAnswered) return;
    const db = getFirestore();
    if (
      !enteredPlanning &&
      !(await leavesInsuranceToTheVenue(db, where.tenantId))
    )
      return;
    await reconcileProjectReadiness(db, where.tenantId, where.projectId);
  },
);
