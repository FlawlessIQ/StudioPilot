/**
 * The post-production record a job needs the moment editing starts.
 *
 * The walk of 2026-08-26 could not deliver a gallery. `recordDelivery` requires
 * `postProductionRecords/{projectId}` with its backup, editing and gallery-ready
 * steps ticked; `completePostProductionStep` refuses with
 * POST_PRODUCTION_NOT_FOUND when the record is absent — and **nothing in the
 * product ever created one.** The only writers in the repository were
 * scripts/seed.ts and a rules test, so every demo job had one and no real job
 * ever would. DELIVERED was unreachable, and with it REVIEW_REQUESTED and
 * CLOSED: the last third of the lifecycle had no entrance.
 *
 * This creates it when a project enters POST_PRODUCTION, with every step
 * incomplete — the studio still has to do the work and say so. It is the same
 * shape of fault as PLANNING → READY having no performer, and the same shape of
 * fix: the state change is the occasion, and nothing is claimed on the studio's
 * behalf.
 */

import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

const REGION = "us-east4";

/** Every step of the post-production ladder, in the order the command enforces. */
const STEP_KEYS = [
  "backup_complete",
  "cull_complete",
  "editing_started",
  "editing_complete",
  "gallery_ready",
  "album_proof_ready",
  "delivery_sent",
  "client_downloaded",
  "project_archived",
] as const;

const emptyStep = () => ({
  complete: false,
  completedAt: null,
  completedBy: null,
  evidenceId: null,
  notes: null,
});

export const postProductionOnProjectEditing = onDocumentWritten(
  { document: "projects/{projectId}", region: REGION },
  async (event) => {
    const project = event.data?.after;
    if (!project?.exists) return;
    if (project.get("state") !== "POST_PRODUCTION") return;
    // Only on the way in. Readiness and other writers touch this row often, and
    // re-entering post-production must not wipe completed steps.
    if (event.data?.before?.get("state") === "POST_PRODUCTION") return;

    const tenantId = String(project.get("tenantId") ?? "");
    const projectId = event.params.projectId;
    if (!tenantId || !projectId) return;

    const db = getFirestore();
    const reference = db.doc(`postProductionRecords/${projectId}`);
    const existing = await reference.get();
    // A record from an earlier pass through editing is the studio's work.
    if (existing.exists) return;

    const now = new Date().toISOString();
    const steps = Object.fromEntries(
      STEP_KEYS.map((key) => [key, emptyStep()]),
    );
    await reference.create({
      id: projectId,
      tenantId,
      projectId,
      steps,
      currentStep: STEP_KEYS[0],
      targetDeliveryDate: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "post-production-opener",
      updatedBy: "post-production-opener",
      archivedAt: null,
    });
  },
);
